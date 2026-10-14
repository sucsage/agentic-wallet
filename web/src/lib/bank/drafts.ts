import "server-only";

import { createHash } from "node:crypto";

import { type Address, formatUnits, getAddress, parseUnits } from "viem";

import type { DealDraft, Prisma } from "@/generated/prisma/client";

import { publicClient, roleAddresses } from "../chain";
import { agentWalletAbi } from "../abis";
import { db } from "../db";
import { walletUnits } from "../state";
import { type FundingResult, fileOfferMandate, fundJustInTime, ownerSignMandate } from "./funding";

/**
 * Bank-paid file deals, in two steps the user can tell apart:
 *   1. the agent drafts (createDraft): nothing is signed, nothing moves, the draft is only in our DB;
 *   2. the user approves (approveDraft): the owner signs the mandate and fundJustInTime debits the
 *      bank, mints and locks the offer in FileEscrow, or refunds if that fails.
 * The draft is read back from the database at approval, so what gets locked is exactly what the
 * user saw; the browser never sends amounts or the seller.
 */

export type DraftMilestone = { name: string; amount: string; hasFile: boolean; due: string | null; acceptance: string };

export type DraftView = {
  id: string;
  wallet: string;
  seller: string;
  sellerLabel: string;
  title: string;
  summary: string;
  milestones: DraftMilestone[];
  total: string;
  symbol: string;
  reviewHours: number;
  status: DealDraft["status"];
  dealId: number | null;
  result: unknown;
  createdAt: Date;
};

export class DraftError extends Error {}

async function sellerAllowed(wallet: Address, seller: Address): Promise<boolean> {
  return publicClient().readContract({ address: wallet, abi: agentWalletAbi, functionName: "allowedRecipient", args: [seller] });
}

export async function draftView(d: DealDraft, sellerLabel = ""): Promise<DraftView> {
  if (!sellerLabel && getAddress(d.seller) === roleAddresses().contractor) sellerLabel = "Demo contractor";
  const units = await walletUnits(getAddress(d.walletAddress));
  const milestones = d.milestones as DraftMilestone[];
  const total = milestones.reduce((t, m) => t + parseUnits(m.amount, units.decimals), 0n);
  return {
    id: d.id,
    wallet: d.walletAddress,
    seller: d.seller,
    sellerLabel,
    title: d.title,
    summary: d.summary,
    milestones,
    total: formatUnits(total, units.decimals),
    symbol: units.symbol,
    reviewHours: d.reviewHours,
    status: d.status,
    dealId: d.dealId,
    result: d.result,
    createdAt: d.createdAt,
  };
}

/** Saves the agent's draft. Refuses sellers the wallet does not allowlist, so approval cannot fail on that. */
export async function createDraft(
  userId: string,
  wallet: Address,
  input: { seller: string; title: string; summary: string; reviewHours: number; milestones: DraftMilestone[] },
): Promise<DealDraft> {
  const units = await walletUnits(wallet);
  if (!units.currency) throw new DraftError("This wallet is not paid from a bank account");
  const seller = getAddress(input.seller);
  if (!(await sellerAllowed(wallet, seller))) throw new DraftError(`Seller ${seller} is not in this wallet's allowlist`);
  for (const m of input.milestones) {
    if (parseUnits(m.amount, units.decimals) <= 0n) throw new DraftError(`Milestone "${m.name}" needs a positive amount`);
  }
  const terms = { title: input.title, summary: input.summary, milestones: input.milestones, reviewHours: input.reviewHours };
  const termsHash = createHash("sha256").update(JSON.stringify(terms)).digest("hex");
  return db.dealDraft.create({
    data: {
      userId,
      walletAddress: wallet,
      seller,
      title: input.title,
      summary: input.summary,
      milestones: input.milestones as unknown as Prisma.InputJsonValue,
      reviewHours: input.reviewHours,
      termsHash,
    },
  });
}

/** The user approves: sign, debit the bank just in time, lock in FileEscrow. Safe to call again. */
export async function approveDraft(userId: string, wallet: Address, draftId: string): Promise<{ draft: DealDraft; funding: FundingResult }> {
  const draft = await db.dealDraft.findFirst({ where: { id: draftId, userId, walletAddress: wallet } });
  if (!draft) throw new DraftError("Draft not found");
  if (draft.status === "CANCELLED") throw new DraftError("This draft was cancelled");
  const units = await walletUnits(wallet);
  const milestones = draft.milestones as DraftMilestone[];

  // Reuse the signed mandate while its funding may still finish (same funding id resumes it).
  // After a definite failure (refunded / rejected) a new attempt needs a new mandate.
  const prior = draft.result as
    | { mandate?: Record<string, string>; signature?: `0x${string}`; funding?: { status?: string } }
    | null;
  const finished = prior?.funding?.status === "REFUNDED" || prior?.funding?.status === "REJECTED";
  let mandate: ReturnType<typeof fileOfferMandate>;
  let signature: `0x${string}`;
  if (prior?.mandate && prior.signature && !finished) {
    const m = prior.mandate;
    mandate = {
      kind: Number(m.kind),
      target: m.target as Address,
      amount: BigInt(m.amount),
      index: BigInt(m.index),
      data: m.data as `0x${string}`,
      reasonHash: m.reasonHash as `0x${string}`,
      nonce: BigInt(m.nonce),
      deadline: BigInt(m.deadline),
    };
    signature = prior.signature;
  } else {
    mandate = fileOfferMandate(
      {
        seller: getAddress(draft.seller),
        milestones: milestones.map((m) => ({ amount: parseUnits(m.amount, units.decimals), hasFile: m.hasFile })),
        reviewPeriod: BigInt(draft.reviewHours * 3600),
        termsURI: `sha256:${draft.termsHash}`,
      },
      draft.title,
      3_600,
      units.address,
    );
    // Demo: the server holds the owner key; the user's click is the approval it signs for.
    signature = await ownerSignMandate(wallet, mandate);
  }
  const keep = {
    mandate: Object.fromEntries(Object.entries(mandate).map(([k, v]) => [k, String(v)])),
    signature,
  };
  await db.dealDraft.update({ where: { id: draft.id }, data: { result: keep as unknown as Prisma.InputJsonValue } });

  const funding = await fundJustInTime(wallet, mandate, signature);
  const status = funding.status === "FUNDED" ? "FUNDED" : funding.status === "PENDING" || funding.status === "COMPENSATING" ? "DRAFT" : "FAILED";
  const updated = await db.dealDraft.update({
    where: { id: draft.id },
    data: {
      status,
      fundingId: funding.fundingId,
      dealId: funding.dealId ?? null,
      result: JSON.parse(
        JSON.stringify({ ...keep, funding }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      ) as Prisma.InputJsonValue,
    },
  });
  return { draft: updated, funding };
}

export function listDrafts(userId: string, wallet: Address) {
  return db.dealDraft.findMany({ where: { userId, walletAddress: wallet }, orderBy: { createdAt: "desc" }, take: 50 });
}
