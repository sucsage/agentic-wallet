import { getAddress } from "viem";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { runDue } from "@/lib/bank/due-route";
import { InviteError, inviteForRequest } from "@/lib/bank/invites";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

/** The invited seller (no account) agrees a milestone's due date with the buyer. */
export async function POST(req: Request, ctx: RouteContext<"/api/invite/[token]/due">) {
  try {
    rateLimit(req, "invite-due", 60, 60 * 60 * 1000);
    const userId = (await getSession())?.user.id ?? null;
    const invite = await inviteForRequest((await ctx.params).token, userId).catch((e) => {
      throw e instanceof InviteError ? new HttpError(404, e.message) : e;
    });
    const body = (await req.json().catch(() => null)) as { dealId?: unknown } | null;
    const dealId = z.number().int().min(0).safeParse(body?.dealId);
    if (!dealId.success) throw new HttpError(400, "Which deal?");
    return Response.json(await runDue(getAddress(invite.sellerWallet), dealId.data, body));
  } catch (err) {
    return errorResponse(err);
  }
}
