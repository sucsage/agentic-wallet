import { after } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";

import { ArbiterError, replyToDispute } from "@/lib/bank/arbiter";
import { DealError, dealForWallet, syncDeal } from "@/lib/bank/deals";
import { InviteError, inviteByToken } from "@/lib/bank/invites";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

export const maxDuration = 300;

/** The invited seller answers a dispute from their link: accept, reject or appeal, with their side. */
export async function POST(req: Request, ctx: RouteContext<"/api/invite/[token]/dispute">) {
  try {
    rateLimit(req, "invite-dispute", 30, 60 * 60 * 1000);
    const invite = await inviteByToken((await ctx.params).token).catch((e) => {
      throw e instanceof InviteError ? new HttpError(404, e.message) : e;
    });
    const body = z
      .object({
        dealId: z.number().int().min(0),
        index: z.number().int().min(0).max(20),
        reply: z.enum(["ACCEPT", "REJECT", "APPEAL"]),
        statement: z.string().max(2000).optional(),
      })
      .safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { dealId, index, reply, statement? }");
    const wallet = getAddress(invite.sellerWallet);
    const deal = await dealForWallet(wallet, body.data.dealId).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    if (deal.role !== "seller") throw new HttpError(403, "Only the seller answers here");
    await replyToDispute(body.data.dealId, body.data.index, "seller", body.data.reply, body.data.statement).catch((e) => {
      throw e instanceof ArbiterError ? new HttpError(400, e.message) : e;
    });
    after(() => syncDeal(wallet, body.data.dealId).catch((e) => console.error("syncDeal", body.data.dealId, e)));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
