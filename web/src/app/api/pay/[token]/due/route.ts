import { getAddress } from "viem";
import { z } from "zod";

import { BuyerInviteError, buyerInviteForRequest } from "@/lib/bank/buyer-invites";
import { runDue } from "@/lib/bank/due-route";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

/** The invited buyer (no account) agrees a milestone's due date, or asks for a late refund. */
export async function POST(req: Request, ctx: RouteContext<"/api/pay/[token]/due">) {
  try {
    rateLimit(req, "pay-due", 60, 60 * 60 * 1000);
    const invite = await buyerInviteForRequest((await ctx.params).token).catch((e) => {
      throw e instanceof BuyerInviteError ? new HttpError(404, e.message) : e;
    });
    const body = (await req.json().catch(() => null)) as { dealId?: unknown } | null;
    const dealId = z.number().int().min(0).safeParse(body?.dealId);
    if (!dealId.success) throw new HttpError(400, "Which deal?");
    return Response.json(await runDue(getAddress(invite.buyerWallet), dealId.data, body));
  } catch (err) {
    return errorResponse(err);
  }
}
