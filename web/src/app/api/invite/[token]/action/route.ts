import { after } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";

import { DealError, sellerAction, syncDeal } from "@/lib/bank/deals";
import { InviteError, inviteByToken } from "@/lib/bank/invites";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

export const maxDuration = 120;

/** The invited seller accepts the buyer's offer (the money is already locked by the buyer). */
export async function POST(req: Request, ctx: RouteContext<"/api/invite/[token]/action">) {
  try {
    rateLimit(req, "invite-action", 30, 60 * 60 * 1000);
    const invite = await inviteByToken((await ctx.params).token).catch((e) => {
      throw e instanceof InviteError ? new HttpError(404, e.message) : e;
    });
    const body = z.object({ action: z.literal("accept"), dealId: z.number().int().min(0) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { action: \"accept\", dealId }");
    const wallet = getAddress(invite.sellerWallet);
    const result = await sellerAction(wallet, body.data.dealId, "accept").catch((e) => {
      throw e instanceof DealError ? new HttpError(400, e.message) : e;
    });
    after(() => syncDeal(wallet, body.data.dealId).catch((e) => console.error("syncDeal", body.data.dealId, e)));
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
