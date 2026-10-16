import { after } from "next/server";
import { z } from "zod";

import { openDispute } from "@/lib/bank/arbiter";
import { DealError, acceptAndPay, buyerAction, dealForWallet, sellerAction, syncDeal } from "@/lib/bank/deals";
import { companyOfWallet } from "@/lib/company";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";
import { SocialError, proposeDealAction } from "@/lib/social";
import { KycRequired, requireKycFor } from "@/lib/kyc";

export const maxDuration = 120;

const Body = z.object({
  action: z.enum(["approve", "dispute", "reclaim", "cancel", "accept", "claim", "refund"]),
  index: z.number().int().min(0).max(20).default(0),
  /** Dispute only: what is wrong, for the neutral arbiter. */
  reason: z.string().max(2000).optional(),
});

/**
 * A move on a deal, pressed by the user. Buyer: approve (the agent's Tier 2 path within its caps,
 * else the owner's mandate), dispute, reclaim, cancel its own offer, accept a seller's offer (paying
 * in from the bank). Seller: accept a buyer's offer, cancel its own offer, claim, refund.
 * Delivering has its own route (it carries a file). On a group's or company's wallet, approving and
 * accepting go to the signers' vote instead.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/action">) {
  try {
    rateLimit(req, "deal-action", 30, 60 * 60 * 1000);
    const { user, customer, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(id) || !parsed.success) throw new HttpError(400, "Invalid request");
    const { action, index, reason } = parsed.data;
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    // Paying in for a seller's offer above the unverified limit needs KYC first.
    if (action === "accept" && deal.role === "buyer") {
      await requireKycFor(user.id, customer.currency, Number(deal.total)).catch((e) => {
        throw e instanceof KycRequired ? new HttpError(403, e.message) : e;
      });
    }
    // A group's or company's wallet pays out only by its signers' vote: releasing a delivery or
    // paying a seller's offer becomes a proposal (the asker's yes counts), executed when it passes.
    if (deal.role === "buyer" && (action === "approve" || action === "accept")) {
      const shared = await companyOfWallet(wallet);
      if (shared) {
        const vote = await proposeDealAction(user.id, shared.groupId, { dealId: id, index, action }).catch((e) => {
          throw e instanceof SocialError ? new HttpError(400, e.message) : e;
        });
        if (vote.status === "EXECUTED") after(() => syncDeal(wallet, id).catch((e) => console.error("syncDeal", id, e)));
        return Response.json({ groupVote: vote });
      }
    }
    if (action === "dispute" && deal.role === "buyer") {
      if (!reason || reason.trim().length < 10) throw new HttpError(400, "Say what is wrong (at least 10 characters): the arbiter decides on it");
      // Recorded before the transaction, so the arbiter has the reason as soon as the chain says Disputed.
      await openDispute(id, index, reason, user.id);
    }
    const run: Promise<unknown> =
      deal.role === "buyer"
        ? action === "accept"
          ? acceptAndPay(wallet, id)
          : buyerAction(wallet, id, action as "approve" | "dispute" | "reclaim" | "cancel", index)
        : action === "accept" || action === "claim" || action === "refund" || action === "cancel"
          ? sellerAction(wallet, id, action, index)
          : Promise.reject(new DealError("Only the buyer can do this"));
    const result = await run.catch((e) => {
      throw e instanceof DealError ? new HttpError(400, e.message) : e;
    });
    after(() => syncDeal(wallet, id).catch((e) => console.error("syncDeal", id, e)));
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
