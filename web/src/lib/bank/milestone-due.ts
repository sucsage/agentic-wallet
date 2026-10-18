import "server-only";

import type { Address } from "viem";

import { config } from "../config";
import { db } from "../db";
import { DealError, dealForWallet, dealTerms } from "./deals";
import type { DraftMilestone } from "./drafts";

/**
 * Delivery due dates per milestone, agreed by both sides. The escrow itself has no delivery
 * deadline (its windows are for reviewing and releasing), so this is an agreement kept here: one
 * side proposes a date, the other accepts it; a due date written in the offer counts as agreed.
 * Past the due date with nothing delivered, the buyer may ask for that milestone's money back: the
 * request goes to the seller (who refunds from the deal page) and stays on the deal's record for
 * the arbiter. Nothing is refunded automatically.
 */

export class DueError extends Error {}

export type DueView = {
  index: number;
  due: string | null;
  proposedDue: string | null;
  proposedBy: "me" | "them" | null;
  late: boolean;
  lateRequestedAt: string | null;
};

const day = (d: Date) => d.toISOString().slice(0, 10);
/** A due date is the end of that day in Bangkok. */
const endOf = (date: string) => new Date(`${date}T23:59:59+07:00`);

async function partyOf(wallet: Address, dealId: number) {
  const deal = await dealForWallet(wallet, dealId).catch((e) => {
    throw e instanceof DealError ? new DueError(e.message) : e;
  });
  const terms = await dealTerms(dealId, deal.role === "buyer" ? wallet : deal.counterparty, deal.role === "seller" ? wallet : deal.counterparty);
  return { deal, planned: ((terms?.milestones ?? []) as DraftMilestone[]).map((m) => m?.due ?? null) };
}

/** The due dates of a deal's milestones as `wallet` sees them (me / them). */
export async function dueDates(wallet: Address, dealId: number): Promise<DueView[]> {
  const { deal, planned } = await partyOf(wallet, dealId);
  const rows = await db.milestoneDue.findMany({ where: { dealId } });
  const me = wallet.toLowerCase();
  return deal.milestones.map((m) => {
    const r = rows.find((x) => x.index === m.index);
    const due = r?.due ? day(r.due) : planned[m.index] ?? null;
    return {
      index: m.index,
      due,
      proposedDue: r?.proposedDue ? day(r.proposedDue) : null,
      proposedBy: r?.proposedBy ? (r.proposedBy === me ? "me" : "them") : null,
      late: Boolean(due && m.status === "Pending" && deal.status === "Active" && endOf(due) < new Date()),
      lateRequestedAt: r?.lateRequestedAt?.toISOString() ?? null,
    };
  });
}

/** Either side proposes a due date for a milestone not delivered yet. */
export async function proposeDue(wallet: Address, dealId: number, index: number, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DueError("Choose a date");
  if (endOf(date) < new Date()) throw new DueError("Choose a date from today on");
  const { deal } = await partyOf(wallet, dealId);
  const m = deal.milestones[index];
  if (!m) throw new DueError("No such milestone");
  if (deal.status === "Cancelled" || !["Pending"].includes(m.status)) throw new DueError("This milestone is already delivered or settled");
  const at = endOf(date);
  await db.milestoneDue.upsert({
    where: { dealId_index: { dealId, index } },
    update: { proposedDue: at, proposedBy: wallet.toLowerCase() },
    create: { dealId, index, proposedDue: at, proposedBy: wallet.toLowerCase() },
  });
  return dueDates(wallet, dealId);
}

/** The other side accepts the proposed date: it becomes the agreed due date. */
export async function acceptDue(wallet: Address, dealId: number, index: number) {
  await partyOf(wallet, dealId);
  const r = await db.milestoneDue.findUnique({ where: { dealId_index: { dealId, index } } });
  if (!r?.proposedDue) throw new DueError("No date was proposed");
  if (r.proposedBy === wallet.toLowerCase()) throw new DueError("The other side accepts the date you proposed");
  await db.milestoneDue.update({ where: { dealId_index: { dealId, index } }, data: { due: r.proposedDue, agreedAt: new Date(), proposedDue: null, proposedBy: null, lateRequestedAt: null } });
  return dueDates(wallet, dealId);
}

/** Past the due date with nothing delivered: the buyer asks the seller for this milestone's money back. */
export async function requestLateRefund(wallet: Address, dealId: number, index: number) {
  const { deal } = await partyOf(wallet, dealId);
  if (deal.role !== "buyer") throw new DueError("Only the buyer asks for a late refund");
  const view = (await dueDates(wallet, dealId)).find((d) => d.index === index);
  if (!view?.late) throw new DueError("This milestone is not late (no agreed due date has passed with nothing delivered)");
  if (view.lateRequestedAt) return dueDates(wallet, dealId);
  await db.milestoneDue.upsert({
    where: { dealId_index: { dealId, index } },
    update: { lateRequestedAt: new Date() },
    create: { dealId, index, due: endOf(view.due!), agreedAt: new Date(), lateRequestedAt: new Date() },
  });
  await db.dealNote.create({
    data: {
      escrow: config.fileEscrowOf(dealId),
      dealId,
      index,
      kind: "LATE",
      author: "buyer",
      text: `Not delivered by the agreed date (${view.due}). The buyer asks for this milestone's money back: refund it from the deal page.`,
    },
  });
  return dueDates(wallet, dealId);
}

/** One handler for every place a due date is set: the website, the private links and the app. */
export async function dueAction(wallet: Address, dealId: number, input: { action: "propose" | "accept" | "late"; index: number; date?: string }) {
  if (!Number.isInteger(input.index) || input.index < 0 || input.index > 20) throw new DueError("No such milestone");
  if (input.action === "propose") return proposeDue(wallet, dealId, input.index, String(input.date ?? ""));
  if (input.action === "accept") return acceptDue(wallet, dealId, input.index);
  return requestLateRefund(wallet, dealId, input.index);
}
