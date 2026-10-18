import { z } from "zod";

import { getSession } from "@/lib/auth";
import { InviteError, inviteForRequest, renameInvite } from "@/lib/bank/invites";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

/** The invited seller writes their own name (the buyer only guessed it when inviting). */
export async function POST(req: Request, ctx: RouteContext<"/api/invite/[token]/name">) {
  try {
    rateLimit(req, "invite-name", 20, 60 * 60 * 1000);
    const invite = await inviteForRequest((await ctx.params).token, (await getSession())?.user.id ?? null).catch((e) => {
      throw e instanceof InviteError ? new HttpError(404, e.message) : e;
    });
    const body = z.object({ name: z.string().min(2).max(80) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Enter your name (2 to 80 characters)");
    const updated = await renameInvite(invite, body.data.name).catch((e) => {
      throw e instanceof InviteError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ name: updated.name });
  } catch (err) {
    return errorResponse(err);
  }
}
