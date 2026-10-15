import { after } from "next/server";
import { z } from "zod";

import { ArbiterError, replyToDispute } from "@/lib/bank/arbiter";
import { DealError, dealForWallet, syncDeal } from "@/lib/bank/deals";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

export const maxDuration = 300;

const Body = z.object({
  index: z.number().int().min(0).max(20),
  /** To the mediator's proposal: ACCEPT or REJECT. To the panel's verdict: ACCEPT or APPEAL. */
  reply: z.enum(["ACCEPT", "REJECT", "APPEAL"]),
  /** The seller's side of the story, for the panel. */
  statement: z.string().max(2000).optional(),
});

/** A party (buyer or seller) answers the dispute; the next step runs right after. */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/dispute">) {
  try {
    rateLimit(req, "dispute-reply", 30, 60 * 60 * 1000);
    const { wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(id) || !body.success) throw new HttpError(400, "Invalid request");
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    await replyToDispute(id, body.data.index, deal.role, body.data.reply, body.data.statement).catch((e) => {
      throw e instanceof ArbiterError ? new HttpError(400, e.message) : e;
    });
    after(() => syncDeal(wallet, id).catch((e) => console.error("syncDeal", id, e)));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
