import { after } from "next/server";
import { z } from "zod";

import { DealError, buyerAction, sellerAction, syncDeal } from "@/lib/bank/deals";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

export const maxDuration = 120;

const Body = z.object({
  action: z.enum(["approve", "dispute", "reclaim", "cancel", "accept", "claim", "refund"]),
  index: z.number().int().min(0).max(20).default(0),
});

/**
 * A move on a deal, pressed by the user. Buyer: approve (the agent's Tier 2 path within its caps,
 * else the owner's mandate), dispute, reclaim, cancel. Seller: accept a buyer's offer, claim, refund.
 * Delivering has its own route (it carries a file).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/action">) {
  try {
    rateLimit(req, "deal-action", 30, 60 * 60 * 1000);
    const { wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(id) || !parsed.success) throw new HttpError(400, "Invalid request");
    const { action, index } = parsed.data;
    const run =
      action === "accept" || action === "claim" || action === "refund"
        ? sellerAction(wallet, id, action, index)
        : buyerAction(wallet, id, action, index);
    const result = await run.catch((e) => {
      throw e instanceof DealError ? new HttpError(400, e.message) : e;
    });
    after(() => syncDeal(wallet, id).catch((e) => console.error("syncDeal", id, e)));
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
