import "server-only";

import type { Address } from "viem";
import { getAddress } from "viem";
import { z } from "zod";

import { DealError, dealForWallet, dealTerms } from "./bank/deals";
import { config } from "./config";
import { db } from "./db";

/**
 * Guarantors (ผู้ค้ำประกัน): each side of a deal may name one person who answers for that side if it
 * does not perform, up to an amount (or the side's whole obligation). A deal can require one from the
 * buyer, the seller or both (DealDraft.guarantorsRequired, part of the terms): then that side cannot
 * sign (accept the offer) before naming theirs. Printed on the contract with a guarantee clause and
 * listed on a complaint. Demo: no identity check (never a national ID number) and nothing is held
 * from the guarantor; it is the written undertaking that counts.
 */

export const GuarantorInput = z.object({
  name: z.string().trim().min(2).max(120),
  contact: z.string().trim().min(5).max(160),
  relation: z.string().trim().min(2).max(80),
  amount: z.number().positive().max(10_000_000).nullable().default(null),
});
export type GuarantorInput = z.infer<typeof GuarantorInput>;

const NATIONAL_ID = /\b\d[\s-]?\d{4}[\s-]?\d{5}[\s-]?\d{2}[\s-]?\d\b/;

export async function saveGuarantor(userId: string, wallet: Address, dealId: number, input: GuarantorInput) {
  if ([input.name, input.contact, input.relation].some((x) => NATIONAL_ID.test(x))) throw new DealError("Do not enter an ID card number: a name, a phone or email and the relation are enough");
  const deal = await dealForWallet(wallet, dealId);
  if (deal.status === "Cancelled") throw new DealError("This deal was withdrawn");
  if (input.amount !== null && input.amount > Number(deal.total)) throw new DealError("A guarantee cannot be larger than the deal's total");
  const escrow = config.fileEscrowOf(dealId);
  const data = { name: input.name, contact: input.contact, relation: input.relation, amount: input.amount, userId };
  await db.dealGuarantor.upsert({ where: { escrow_dealId_side: { escrow, dealId, side: deal.role } }, update: data, create: { escrow, dealId, side: deal.role, ...data } });
}

export async function removeGuarantor(wallet: Address, dealId: number) {
  const deal = await dealForWallet(wallet, dealId);
  if (deal.status !== "Proposed" && (await required(dealId, wallet, deal.role, getAddress(deal.counterparty)))) {
    throw new DealError("This deal required your guarantor when it was signed: it stays on the contract");
  }
  await db.dealGuarantor.deleteMany({ where: { escrow: config.fileEscrowOf(dealId), dealId, side: deal.role } });
}

async function required(dealId: number, wallet: Address, role: "buyer" | "seller", other: Address) {
  const terms = await dealTerms(dealId, role === "buyer" ? wallet : other, role === "seller" ? wallet : other);
  const r = terms?.guarantorsRequired;
  return r === "both" || r === role;
}

/** Throws when the side about to sign (accept) must name a guarantor first and has not. */
export async function requireGuarantorBeforeSigning(dealId: number, role: "buyer" | "seller", buyer: Address, seller: Address) {
  const terms = await dealTerms(dealId, buyer, seller);
  const r = terms?.guarantorsRequired;
  if (r !== "both" && r !== role) return;
  const has = await db.dealGuarantor.findUnique({ where: { escrow_dealId_side: { escrow: config.fileEscrowOf(dealId), dealId, side: role } } });
  if (!has) throw new DealError("This deal requires your guarantor (ผู้ค้ำประกัน): add one under “Guarantors” before you accept");
}

export function guarantorsOf(dealId: number) {
  return db.dealGuarantor.findMany({ where: { escrow: config.fileEscrowOf(dealId), dealId } });
}
