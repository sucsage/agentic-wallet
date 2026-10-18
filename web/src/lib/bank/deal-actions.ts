import "server-only";

import { after } from "next/server";
import type { Address } from "viem";

import { companyOfWallet } from "../company";
import { HttpError } from "../guard";
import { KycRequired, requireKycFor } from "../kyc";
import { SocialError, proposeDealAction } from "../social";
import { config } from "../config";
import { openDispute } from "./arbiter";
import { DealError, acceptAndPay, buyerAction, dealForWallet, sellerAction, syncDeal } from "./deals";

export type DealMove = "approve" | "dispute" | "reclaim" | "cancel" | "accept" | "claim" | "refund";
export const DEAL_MOVES: DealMove[] = ["approve", "dispute", "reclaim", "cancel", "accept", "claim", "refund"];

/**
 * One move on a deal by its user: the website's deal page and the desktop app's signed intents both
 * come here. Buyer: approve (the agent's Tier 2 path within its caps, else the owner's mandate),
 * dispute, reclaim, cancel its own offer, accept a seller's offer (paying in from the bank). Seller:
 * accept a buyer's offer, cancel its own offer, claim, refund. On a group's or company's wallet,
 * approving and accepting go to the signers' vote instead.
 */
export async function runDealMove(
  who: { userId: string; currency: "THB" | "CNY"; wallet: Address },
  id: number,
  action: DealMove,
  index: number,
  reason?: string,
): Promise<unknown> {
  const { userId, currency, wallet } = who;
  const deal = await dealForWallet(wallet, id).catch((e) => {
    throw e instanceof DealError ? new HttpError(404, e.message) : e;
  });
  // Paying in for a seller's offer above the unverified limit needs KYC first.
  if (action === "accept" && deal.role === "buyer") {
    await requireKycFor(userId, currency, Number(deal.total)).catch((e) => {
      throw e instanceof KycRequired ? new HttpError(403, e.message) : e;
    });
  }
  // A group's or company's wallet pays out only by its signers' vote: releasing a delivery or
  // paying a seller's offer becomes a proposal (the asker's yes counts), executed when it passes.
  if (deal.role === "buyer" && (action === "approve" || action === "accept")) {
    const shared = await companyOfWallet(wallet);
    if (shared) {
      const vote = await proposeDealAction(userId, shared.groupId, { dealId: id, index, action }).catch((e) => {
        throw e instanceof SocialError ? new HttpError(400, e.message) : e;
      });
      if (vote.status === "EXECUTED") after(() => syncDeal(wallet, id).catch((e) => console.error("syncDeal", id, e)));
      return { groupVote: vote };
    }
  }
  if (action === "dispute" && !config.disputesOpen) throw new HttpError(400, "Disputes are turned off: approve the delivery or ask the seller for changes");
  if (action === "dispute" && deal.role === "buyer") {
    if (!reason || reason.trim().length < 10) throw new HttpError(400, "Say what is wrong (at least 10 characters): the arbiter decides on it");
    // Recorded before the transaction, so the arbiter has the reason as soon as the chain says Disputed.
    await openDispute(id, index, reason, userId);
  }
  const run: Promise<unknown> =
    deal.role === "buyer"
      ? action === "accept"
        ? acceptAndPay(wallet, id)
        : action === "approve" || action === "dispute" || action === "reclaim" || action === "cancel"
          ? buyerAction(wallet, id, action, index)
          : Promise.reject(new DealError("Only the seller can do this"))
      : action === "accept" || action === "claim" || action === "refund" || action === "cancel"
        ? sellerAction(wallet, id, action, index)
        : Promise.reject(new DealError("Only the buyer can do this"));
  const result = await run.catch((e) => {
    throw e instanceof DealError ? new HttpError(400, e.message) : e;
  });
  after(() => syncDeal(wallet, id).catch((e) => console.error("syncDeal", id, e)));
  return result;
}
