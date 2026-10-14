import { after } from "next/server";
import { z } from "zod";

import { DealError, buyerAction, syncDeal } from "@/lib/bank/deals";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

export const maxDuration = 120;

const Body = z.object({
  action: z.enum(["approve", "dispute", "reclaim", "cancel"]),
  index: z.number().int().min(0).max(20).default(0),
});

/**
 * The buyer's move on a deal, pressed by the user. Approving a delivery runs on the agent's own
 * authority when within its caps (Tier 2), otherwise on the owner's signed mandate (Tier 1).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/action">) {
  try {
    rateLimit(req, "deal-action", 30, 60 * 60 * 1000);
    const { wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(id) || !parsed.success) throw new HttpError(400, "Invalid request");
    const result = await buyerAction(wallet, id, parsed.data.action, parsed.data.index).catch((e) => {
      throw e instanceof DealError ? new HttpError(400, e.message) : e;
    });
    after(() => syncDeal(wallet, id).catch((e) => console.error("syncDeal", id, e)));
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
