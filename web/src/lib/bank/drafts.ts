import "server-only";

import { createHash } from "node:crypto";

import { type Address, formatUnits, getAddress, hashTypedData, parseUnits } from "viem";

import type { DealDraft, Prisma } from "@/generated/prisma/client";

import { publicClient, roleAddresses, send } from "../chain";
import { accountOf } from "./ledger";
import { agentWalletAbi } from "../abis";
import { db } from "../db";
import { KycRequired, requireKycFor } from "../kyc";
import { walletUnits } from "../state";
import { offerToSell } from "./deals";
import { type FundingResult, fileOfferMandate, fundJustInTime, mintCapError, ownerSignMandate, typedMandate } from "./funding";
import { coverShortfall } from "./stripe-link";
import { TopupError } from "./topup";

/**
 * Bank-paid file deals, in two steps the user can tell apart:
 *   1. the agent drafts (createDraft): nothing is signed, nothing moves, the draft is only in our DB;
 *   2. the user approves (approveDraft): the owner signs the mandate and fundJustInTime debits the
 *      bank, mints and locks the offer in FileEscrow, or refunds if that fails.
 * A seller drafts too (side SELL): approving makes the offer on-chain and locks nothing; the buyer
 * pays in from their bank when they accept it (acceptAndPay in deals.ts).
 * The draft is read back from the database at approval, so what gets locked is exactly what the
 * user saw; the browser never sends amounts or the seller.
 */

/** `delivery`: "file" (encrypted file), "parcel" (shipped, tracked by post) or "note" (evidence only).
 *  Older drafts have only hasFile. */
export type DraftMilestone = {
  name: string;
  amount: string;
  hasFile: boolean;
  delivery?: "file" | "parcel" | "note";
  due: string | null;
  acceptance: string;
  /** A deposit: paid to the seller as soon as the contract is signed (the offer accepted), no delivery needed. First milestone only. */
  deposit?: boolean;
};

export const deliveryOf = (m: Pick<DraftMilestone, "hasFile" | "delivery"> | undefined) => m?.delivery ?? (m?.hasFile ? "file" : "note");

export type DraftView = {
  id: string;
  side: "BUY" | "SELL";
  /** HIRE: a person's work (service). GOODS: a thing bought (a file or a parcel). */
  kind: "HIRE" | "GOODS";
  shipTo: string | null;
  wallet: string;
  /** The other party: the seller of a BUY draft, the buyer of a SELL draft. */
  counterparty: string;
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
  /** An amendment of this deal (an offer not accepted yet): confirming replaces it. */
  replacesDealId: number | null;
  result: unknown;
  createdAt: Date;
};

export class DraftError extends Error {}

async function sellerAllowed(wallet: Address, seller: Address): Promise<boolean> {
  return publicClient().readContract({ address: wallet, abi: agentWalletAbi, functionName: "allowedRecipient", args: [seller] });
}

export async function draftView(d: DealDraft, sellerLabel = ""): Promise<DraftView> {
  // Someone without an account: their wallet and link are made on Confirm.
  if (!sellerLabel && d.inviteName) sellerLabel = d.inviteId ? `${d.inviteName} (invited)` : `${d.inviteName} (new · link made on Confirm)`;
  if (!sellerLabel && d.seller && getAddress(d.seller) === roleAddresses().contractor) sellerLabel = "Demo contractor";
  const units = await walletUnits(getAddress(d.walletAddress));
  const milestones = d.milestones as DraftMilestone[];
  const total = milestones.reduce((t, m) => t + parseUnits(m.amount, units.decimals), 0n);
  return {
    id: d.id,
    side: d.side,
    kind: d.kind,
    shipTo: d.shipTo,
    wallet: d.walletAddress,
    counterparty: d.side === "SELL" ? (d.buyer ?? "") : d.seller,
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
    replacesDealId: d.replacesDealId,
    result: d.result,
    createdAt: d.createdAt,
  };
}

/** What the termsHash commits to. Older drafts hashed only the first four fields. */
function termsOf(input: { kind?: string; shipTo?: string | null; title: string; summary: string; reviewHours: number; milestones: DraftMilestone[] }) {
  const base = { title: input.title, summary: input.summary, milestones: input.milestones, reviewHours: input.reviewHours };
  return { ...base, kind: input.kind ?? "HIRE", ...(input.shipTo ? { shipTo: input.shipTo } : {}) };
}

/** Saves the agent's draft as a PREVIEW (nothing exists until the user confirms it). Refuses sellers the wallet does not allowlist, so approval cannot fail on that. */
export async function createDraft(
  userId: string,
  wallet: Address,
  input: { seller: string; inviteName?: string | null; kind?: "HIRE" | "GOODS"; shipTo?: string | null; title: string; summary: string; reviewHours: number; milestones: DraftMilestone[] },
): Promise<DealDraft> {
  const units = await walletUnits(wallet);
  if (!units.currency) throw new DraftError("This wallet is not paid from a bank account");
  // A seller without an account has no wallet yet: it (and their link) is made on Confirm.
  const seller = input.inviteName ? "" : getAddress(input.seller);
  // A company's or group's wallet needs no allowlist entry first: its signers' vote approves the
  // seller, who is added as payee when the vote passes (see allowSellerAfterVote).
  const shared = await db.company.findUnique({ where: { walletAddress: getAddress(wallet) } });
  if (seller && !shared && !(await sellerAllowed(wallet, seller as Address))) throw new DraftError(`Seller ${seller} is not in this wallet's allowlist`);
  for (const m of input.milestones) {
    if (parseUnits(m.amount, units.decimals) <= 0n) throw new DraftError(`Milestone "${m.name}" needs a positive amount`);
  }
  const terms = termsOf(input);
  const termsHash = createHash("sha256").update(JSON.stringify(terms)).digest("hex");
  return db.dealDraft.create({
    data: {
      userId,
      status: "PREVIEW",
      walletAddress: wallet,
      seller,
      inviteName: input.inviteName?.trim().slice(0, 80) || null,
      kind: input.kind ?? "HIRE",
      shipTo: input.shipTo || null,
      title: input.title,
      summary: input.summary,
      milestones: input.milestones as unknown as Prisma.InputJsonValue,
      reviewHours: input.reviewHours,
      termsHash,
    },
  });
}

/**
 * The seller's draft: work offered to a buyer. Nothing is locked, so the buyer need not allowlist
 * the seller yet (they must before accepting). The buyer must bank in the same currency to pay.
 */
export async function createSellDraft(
  userId: string,
  wallet: Address,
  input: { buyer: string; inviteName?: string | null; kind?: "HIRE" | "GOODS"; shipTo?: string | null; title: string; summary: string; reviewHours: number; milestones: DraftMilestone[] },
): Promise<DealDraft> {
  const units = await walletUnits(wallet);
  if (!units.currency) throw new DraftError("This wallet is not paid from a bank account");
  // A buyer without an account has no wallet yet: it (and their link) is made on Confirm.
  const buyer = input.inviteName ? null : getAddress(input.buyer);
  if (buyer) {
    if (buyer === wallet) throw new DraftError("You cannot sell to yourself");
    const buyerAccount = await accountOf(buyer);
    if (!buyerAccount) throw new DraftError(`Buyer ${buyer} has no Mock Bank wallet`);
    if (buyerAccount.currency !== units.currency) throw new DraftError(`The buyer banks in ${buyerAccount.currency}, this wallet in ${units.currency}`);
  }
  for (const m of input.milestones) {
    if (parseUnits(m.amount, units.decimals) <= 0n) throw new DraftError(`Milestone "${m.name}" needs a positive amount`);
  }
  const terms = termsOf(input);
  const termsHash = createHash("sha256").update(JSON.stringify(terms)).digest("hex");
  return db.dealDraft.create({
    data: {
      userId,
      status: "PREVIEW",
      side: "SELL",
      walletAddress: wallet,
      seller: wallet,
      buyer,
      inviteName: input.inviteName?.trim().slice(0, 80) || null,
      kind: input.kind ?? "HIRE",
      shipTo: input.shipTo || null,
      title: input.title,
      summary: input.summary,
      milestones: input.milestones as unknown as Prisma.InputJsonValue,
      reviewHours: input.reviewHours,
      termsHash,
    },
  });
}

/**
 * Changing a deal that was confirmed but not accepted yet: a new preview with the same other party
 * (the same wallet, and the same private link for someone without an account). Confirming it
 * withdraws the old offer first (approveDraft), so there is never a second deal.
 */
export async function createAmendDraft(
  userId: string,
  wallet: Address,
  dealId: number,
  changes: { kind?: "HIRE" | "GOODS"; shipTo?: string | null; title?: string; summary?: string; reviewHours?: number; milestones?: DraftMilestone[] },
): Promise<DealDraft> {
  const { dealForWallet } = await import("./deals");
  const deal = await dealForWallet(wallet, dealId).catch(() => null);
  if (!deal) throw new DraftError(`No deal D-${dealId} in this wallet`);
  if (deal.status !== "Proposed") throw new DraftError(`D-${dealId} was already accepted (${deal.status}): its terms are fixed now. Changes need the other side to agree, e.g. cancel by agreement or a dispute.`);
  if (deal.offeredBy !== "me") throw new DraftError(`D-${dealId} is the other side's offer: ask them to change it, or decline it`);
  const old = await db.dealDraft.findFirst({ where: { userId, walletAddress: wallet, dealId }, orderBy: { createdAt: "desc" } });
  if (!old) throw new DraftError(`D-${dealId} was not made from a draft here, so it cannot be amended`);
  const units = await walletUnits(wallet);
  const milestones = changes.milestones ?? (old.milestones as DraftMilestone[]);
  for (const m of milestones) {
    if (parseUnits(m.amount, units.decimals) <= 0n) throw new DraftError(`Milestone "${m.name}" needs a positive amount`);
  }
  const input = {
    kind: changes.kind ?? old.kind,
    shipTo: changes.shipTo === undefined ? old.shipTo : changes.shipTo,
    title: changes.title ?? old.title,
    summary: changes.summary ?? old.summary,
    reviewHours: changes.reviewHours ?? old.reviewHours,
    milestones,
  };
  const termsHash = createHash("sha256").update(JSON.stringify(termsOf(input))).digest("hex");
  // Earlier amendment previews of the same deal are superseded.
  await db.dealDraft.updateMany({ where: { userId, replacesDealId: dealId, status: "PREVIEW" }, data: { status: "CANCELLED" } });
  return db.dealDraft.create({
    data: {
      userId,
      status: "PREVIEW",
      side: old.side,
      walletAddress: wallet,
      seller: old.seller,
      buyer: old.buyer,
      inviteName: old.inviteName,
      inviteId: old.inviteId,
      kind: input.kind,
      shipTo: input.shipTo || null,
      title: input.title,
      summary: input.summary,
      milestones: input.milestones as unknown as Prisma.InputJsonValue,
      reviewHours: input.reviewHours,
      termsHash,
      replacesDealId: dealId,
    },
  });
}

/** Withdraws the offer an amendment replaces. Refuses if the other side accepted it meanwhile. */
async function withdrawReplaced(wallet: Address, d: DealDraft) {
  if (d.replacesDealId === null || d.status === "FUNDED") return;
  const { buyerAction, dealForWallet, sellerAction, syncDeal } = await import("./deals");
  const old = await dealForWallet(wallet, d.replacesDealId).catch(() => null);
  if (!old || old.status === "Cancelled") return;
  if (old.status !== "Proposed") throw new DraftError(`The other side already accepted D-${d.replacesDealId}, so it can no longer be changed. Nothing new was created.`);
  const r = old.role === "buyer" ? await buyerAction(wallet, d.replacesDealId, "cancel") : await sellerAction(wallet, d.replacesDealId, "cancel");
  if (r.outcome.status !== "success") throw new DraftError(`Could not withdraw D-${d.replacesDealId} first${"error" in r.outcome && r.outcome.error ? `: ${r.outcome.error}` : ""}`);
  // A purchase's locked money goes back to the wallet before the new one is locked.
  await syncDeal(wallet, d.replacesDealId).catch((e) => console.error("syncDeal", d.replacesDealId, e));
}

/** The user approves: sign, debit the bank just in time, lock in FileEscrow. Safe to call again. */
export async function approveDraft(
  userId: string,
  wallet: Address,
  draftId: string,
  opts: { viaGroup?: boolean } = {},
): Promise<{ draft: DealDraft; funding: FundingResult }> {
  const draft = await db.dealDraft.findFirst({ where: { id: draftId, userId, walletAddress: wallet } });
  if (!draft) throw new DraftError("Draft not found");
  if (draft.status === "CANCELLED") throw new DraftError("This draft was cancelled");
  // A draft put to a group's vote is locked by the vote, not by its proposer alone.
  if (!opts.viaGroup && (await db.groupProposal.findFirst({ where: { draftId, status: "OPEN" } }))) {
    throw new DraftError("This draft is waiting for its group's vote. It is locked when enough members approve.");
  }
  // A company's or group wallet's deal (a purchase, or an offer to sell in its name) happens only
  // by its signers' vote (N of M), never by one member.
  if (!opts.viaGroup && (await db.company.findUnique({ where: { walletAddress: getAddress(wallet) } }))) {
    throw new DraftError("A deal in a company's or group's name needs its signers' approval: submit it for their vote.");
  }
  // One approval at a time (DB-01): overlapping clicks used to sign several mandates and lock the
  // same draft several times. The lease expires on its own if a request dies half way.
  const claimed = await db.dealDraft.updateMany({
    where: { id: draft.id, OR: [{ approvingUntil: null }, { approvingUntil: { lt: new Date() } }] },
    data: { approvingUntil: new Date(Date.now() + 120_000) },
  });
  if (claimed.count !== 1) throw new DraftError("This draft is already being approved. Wait a few seconds: it is never charged twice.");
  try {
    // Re-read: an approval that just finished may have funded it or stored its mandate.
    let fresh = await db.dealDraft.findUniqueOrThrow({ where: { id: draft.id } });
    const done = (fresh.result as { funding?: FundingResult } | null)?.funding;
    if (fresh.status === "FUNDED" && done) return { draft: fresh, funding: done };
    fresh = await ensureInvite(userId, wallet, fresh);
    await withdrawReplaced(wallet, fresh);
    if (opts.viaGroup) await allowSellerAfterVote(wallet, fresh);
    return await approveClaimed(userId, wallet, fresh);
  } finally {
    await db.dealDraft.update({ where: { id: draft.id }, data: { approvingUntil: null } });
  }
}

/**
 * Confirming a deal with someone who has no account makes their link now (not when the AI drafted
 * it): a seller link for a purchase, a buyer link for a sale. Their wallet allows this one as payee,
 * and the draft then points at it. Done once; a retry reuses the invite.
 */
async function ensureInvite(userId: string, wallet: Address, d: DealDraft): Promise<DealDraft> {
  if (!d.inviteName || d.inviteId) return d;
  if (d.side === "BUY") {
    const { InviteError, createInvite } = await import("./invites");
    const { invite } = await createInvite(userId, wallet, d.inviteName).catch((e) => {
      throw e instanceof InviteError ? new DraftError(e.message) : e;
    });
    return db.dealDraft.update({ where: { id: d.id }, data: { seller: invite.sellerWallet, inviteId: invite.id } });
  }
  const { BuyerInviteError, createBuyerInvite } = await import("./buyer-invites");
  const { invite } = await createBuyerInvite(userId, wallet, d.inviteName).catch((e) => {
    throw e instanceof BuyerInviteError ? new DraftError(e.message) : e;
  });
  return db.dealDraft.update({ where: { id: d.id }, data: { buyer: invite.buyerWallet, inviteId: invite.id } });
}

/** The signers voted for this purchase: its seller becomes a payee of the shared wallet. */
async function allowSellerAfterVote(wallet: Address, d: DealDraft) {
  if (d.side !== "BUY" || !d.seller) return;
  const seller = getAddress(d.seller);
  if (await sellerAllowed(wallet, seller)) return;
  const r = await send("owner", { address: wallet, abi: agentWalletAbi, functionName: "setRecipient", args: [seller, true] });
  if (r.status !== "success") throw new DraftError(`Could not add the seller as a payee${"error" in r && r.error ? `: ${r.error}` : ""}`);
}

async function approveClaimed(userId: string, wallet: Address, draft: DealDraft): Promise<{ draft: DealDraft; funding: FundingResult }> {
  const units = await walletUnits(wallet);
  const milestones = draft.milestones as DraftMilestone[];
  if (draft.side === "SELL") return approveSellDraft(draft, wallet, units, milestones);
  // Locking money above the unverified limit needs a verified identity (KYC) first.
  if (draft.status !== "FUNDED" && units.currency) {
    const total = milestones.reduce((t, m) => t + Number(m.amount), 0);
    await requireKycFor(userId, units.currency, total).catch((e) => {
      throw e instanceof KycRequired ? new DraftError(e.message) : e;
    });
  }

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

  // A short bank balance is covered from the linked Stripe card first (once per funding id).
  const fundingId = hashTypedData(typedMandate(wallet, mandate));
  if (!(await db.bankTransfer.findUnique({ where: { idempotencyKey: `funding:${fundingId}:debit` } }))) {
    // Never charge the card for a deal the bank token cannot mint.
    const capError = await mintCapError(units.address, mandate.amount, units.currency ?? "");
    if (capError) throw new DraftError(capError);
    await coverShortfall(wallet, mandate.amount, `funding:${fundingId}`).catch((e) => {
      throw e instanceof TopupError ? new DraftError(e.message) : e;
    });
  }
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

/** A seller's draft goes on-chain as an offer; nothing is debited. Once offered, it stays offered. */
async function approveSellDraft(
  draft: DealDraft,
  wallet: Address,
  units: Awaited<ReturnType<typeof walletUnits>>,
  milestones: DraftMilestone[],
): Promise<{ draft: DealDraft; funding: FundingResult }> {
  const prior = draft.result as { funding?: FundingResult } | null;
  if (draft.status === "FUNDED" && prior?.funding) return { draft, funding: prior.funding };
  const { outcome, dealId } = await offerToSell(wallet, {
    buyer: getAddress(draft.buyer!),
    milestones: milestones.map((m) => ({ amount: parseUnits(m.amount, units.decimals), hasFile: m.hasFile })),
    reviewPeriod: BigInt(draft.reviewHours * 3600),
    termsURI: `sha256:${draft.termsHash}`,
    reason: draft.title,
  });
  const funding: FundingResult = {
    status: dealId !== undefined ? "FUNDED" : outcome.status === "reverted" || outcome.status === "rejected" ? "REJECTED" : "PENDING",
    fundingId: outcome.status === "success" ? outcome.hash : (`0x${"0".repeat(64)}` as `0x${string}`),
    amount: 0n,
    dealId,
    steps: [{ step: "lock", outcome }],
    error: "error" in outcome ? outcome.error : undefined,
  };
  const updated = await db.dealDraft.update({
    where: { id: draft.id },
    data: {
      status: funding.status === "FUNDED" ? "FUNDED" : funding.status === "PENDING" ? "DRAFT" : "FAILED",
      dealId: dealId ?? null,
      result: JSON.parse(JSON.stringify({ funding }, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Prisma.InputJsonValue,
    },
  });
  return { draft: updated, funding };
}

/** Discarding a draft also withdraws it from any group vote it was in. */
export async function discardDraft(userId: string, wallet: Address, draftId: string): Promise<boolean> {
  const done = await db.dealDraft.updateMany({
    where: { id: draftId, userId, walletAddress: wallet, status: { in: ["PREVIEW", "DRAFT", "FAILED"] } },
    data: { status: "CANCELLED" },
  });
  if (done.count === 1) await db.groupProposal.updateMany({ where: { draftId, status: "OPEN" }, data: { status: "REJECTED" } });
  return done.count === 1;
}

export function listDrafts(userId: string, wallet: Address) {
  return db.dealDraft.findMany({ where: { userId, walletAddress: wallet }, orderBy: { createdAt: "desc" }, take: 50 });
}
