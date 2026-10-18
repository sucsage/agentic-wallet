import "server-only";

import { type Address, getAddress, parseUnits } from "viem";

import type { DealDraft, PaymentPlan } from "@/generated/prisma/client";

import { db } from "../db";
import { walletUnits } from "../state";
import { InsufficientFunds, accountOf, openAccount, transfer } from "./ledger";

/**
 * Split payment (แบ่งจ่าย): the buyer pays a deal in parts, on dates agreed in the terms, and only
 * when every part is paid is the whole amount locked in escrow and the seller asked to deliver. It is
 * not an instalment plan (ผ่อน, goods first and pay later): nobody gets anything before the money is
 * complete. The parts wait in a holding account of the plan, not in the buyer's balance, so they
 * cannot be spent twice; cancelling (or a part more than 7 days late) returns them to the buyer.
 *
 * A buyer's purchase with a plan: Confirm pays part 1, and paying the last part locks the deal as if
 * it had been confirmed in one go. A seller's offer with a plan: the offer goes on-chain as usual; the
 * buyer starts the plan from the deal's page, and paying the last part accepts the offer.
 */

export type PlanPart = { amount: string; due: string };
export class PlanError extends Error {}

export const LATE_DAYS = 7;
export const MAX_PARTS = 12;

/** Today in Thailand (due dates are Bangkok dates). */
const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

/** Checks a plan from the agent or a template: 2-12 parts, adding up to the total, dates in order, the first due now. */
export function checkPlan(parts: { amount: number; due: string }[], total: number): PlanPart[] {
  if (parts.length < 2 || parts.length > MAX_PARTS) throw new PlanError(`A split payment has 2 to ${MAX_PARTS} parts`);
  const sum = Math.round(parts.reduce((t, p) => t + p.amount, 0) * 100) / 100;
  if (Math.abs(sum - total) > 0.005) throw new PlanError(`The parts add up to ${sum}, not the total ${total}`);
  let prev = "";
  const out: PlanPart[] = [];
  for (const [i, p] of parts.entries()) {
    if (!(p.amount > 0)) throw new PlanError(`Part ${i + 1} needs an amount above 0`);
    const due = i === 0 ? p.due || today() : p.due;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due ?? "")) throw new PlanError(`Part ${i + 1} needs a due date (YYYY-MM-DD)`);
    if (prev && due < prev) throw new PlanError("The due dates must be in order");
    prev = due;
    out.push({ amount: p.amount.toFixed(2), due });
  }
  return out;
}

export const planOf = (d: Pick<DealDraft, "paymentPlan">): PlanPart[] | null => (Array.isArray(d.paymentPlan) ? (d.paymentPlan as PlanPart[]) : null);

/** The last day an offer paid by a plan stays open: the last part's due date plus the grace days. */
export function planEnds(parts: PlanPart[]): Date {
  return new Date(new Date(`${parts[parts.length - 1].due}T23:59:59+07:00`).getTime() + LATE_DAYS * 86_400_000);
}

/** What the app shows about a plan: each part, whether it is paid, due or late. */
export function planView(parts: PlanPart[], plan: PaymentPlan | null) {
  const now = today();
  return {
    id: plan?.id ?? null,
    status: plan?.status ?? "NOT_STARTED",
    paidParts: plan?.paidParts ?? 0,
    parts: parts.map((p, i) => ({
      ...p,
      paid: (plan?.paidParts ?? 0) > i,
      late: (plan?.paidParts ?? 0) <= i && p.due < now,
    })),
    paid: parts.slice(0, plan?.paidParts ?? 0).reduce((t, p) => t + Number(p.amount), 0),
    total: parts.reduce((t, p) => t + Number(p.amount), 0),
  };
}

async function heldAccount(plan: PaymentPlan, currency: "THB" | "CNY") {
  if (plan.heldAccountId) return plan.heldAccountId;
  const acc = await openAccount(`plan:${plan.id}`, "Split payment held", currency);
  await db.paymentPlan.update({ where: { id: plan.id }, data: { heldAccountId: acc.id } });
  return acc.id;
}

/** Starts the plan (paying part 1). For a purchase: on Confirm. For a seller's offer: by the buyer. */
export async function startPlan(userId: string, payer: Address, draft: DealDraft): Promise<PaymentPlan> {
  const parts = planOf(draft);
  if (!parts) throw new PlanError("This deal has no split payment");
  const existing = await db.paymentPlan.findUnique({ where: { draftId: draft.id } });
  if (existing && existing.status === "ACTIVE") return existing;
  if (existing) throw new PlanError(`This split payment is ${existing.status.toLowerCase()}`);
  const plan = await db.paymentPlan.create({ data: { draftId: draft.id, payerWallet: getAddress(payer), payerUserId: userId } });
  return payNextPart(userId, plan.id);
}

/** Pays the next part from the buyer's balance into the plan. Returns the plan; the caller locks the deal when it is complete. */
export async function payNextPart(userId: string, planId: string): Promise<PaymentPlan> {
  const plan = await db.paymentPlan.findUnique({ where: { id: planId }, include: { draft: true } });
  if (!plan || plan.payerUserId !== userId) throw new PlanError("Split payment not found");
  if (plan.status !== "ACTIVE") throw new PlanError(`This split payment is ${plan.status.toLowerCase()}`);
  const parts = planOf(plan.draft)!;
  if (plan.paidParts >= parts.length) return plan;
  const wallet = getAddress(plan.payerWallet);
  const units = await walletUnits(wallet);
  const account = await accountOf(wallet);
  if (!account || !units.currency) throw new PlanError("This wallet has no bank account");
  const held = await heldAccount(plan, units.currency);
  const n = plan.paidParts;
  try {
    await transfer({ key: `plan:${plan.id}:part:${n}`, kind: "PLAN", fromId: account.id, toId: held, amount: parseUnits(parts[n].amount, 2) });
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new PlanError(`Not enough money for part ${n + 1} (${parts[n].amount}): top up first`);
    throw e;
  }
  // Only this part's transfer moves the counter, so a retry never counts a part twice.
  await db.paymentPlan.updateMany({ where: { id: plan.id, paidParts: n }, data: { paidParts: n + 1 } });
  return db.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
}

/** Moves everything held back to the buyer's balance (completion, cancel or lapse). */
async function releaseHeld(plan: PaymentPlan, why: "complete" | "refund") {
  if (!plan.heldAccountId) return;
  const held = await db.bankAccount.findUniqueOrThrow({ where: { id: plan.heldAccountId } });
  if (held.balance <= 0n) return;
  const buyer = await accountOf(getAddress(plan.payerWallet));
  if (!buyer) throw new PlanError("The buyer's account is gone");
  await transfer({ key: `plan:${plan.id}:${why}`, kind: "PLAN", fromId: held.id, toId: buyer.id, amount: held.balance });
}

/**
 * Every part is paid: the money goes back to the buyer's balance and, in the same step, the deal is
 * locked (a purchase is confirmed, a seller's offer accepted), which debits the whole amount again.
 */
export async function completePlan(planId: string, lock: () => Promise<boolean>): Promise<PaymentPlan> {
  const plan = await db.paymentPlan.findUniqueOrThrow({ where: { id: planId }, include: { draft: true } });
  if (plan.status !== "ACTIVE" || plan.paidParts < planOf(plan.draft)!.length) return plan;
  await releaseHeld(plan, "complete");
  const locked = await lock();
  if (locked) return db.paymentPlan.update({ where: { id: plan.id }, data: { status: "COMPLETE", completedAt: new Date() } });
  // Locking failed: the money is in the buyer's balance; the plan stays ACTIVE and complete, so "Lock now" retries.
  return plan;
}

export async function cancelPlan(userId: string, planId: string, status: "CANCELLED" | "LAPSED" = "CANCELLED"): Promise<PaymentPlan> {
  const plan = await db.paymentPlan.findUnique({ where: { id: planId } });
  if (!plan || (status === "CANCELLED" && plan.payerUserId !== userId)) throw new PlanError("Split payment not found");
  if (plan.status !== "ACTIVE") return plan;
  await releaseHeld(plan, "refund");
  return db.paymentPlan.update({ where: { id: plan.id }, data: { status } });
}

/** A plan with a part more than 7 days late lapses: what was paid goes back to the buyer. */
export async function lapseIfLate(plan: PaymentPlan & { draft: DealDraft }): Promise<boolean> {
  if (plan.status !== "ACTIVE") return false;
  const parts = planOf(plan.draft);
  if (!parts || plan.paidParts >= parts.length) return false;
  const late = new Date(`${parts[plan.paidParts].due}T23:59:59+07:00`).getTime() + LATE_DAYS * 86_400_000 < Date.now();
  if (!late) return false;
  await cancelPlan(plan.payerUserId, plan.id, "LAPSED");
  return true;
}
