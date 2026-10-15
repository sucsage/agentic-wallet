import { z } from "zod";

import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, answerGroupInvite } from "@/lib/social";

/** Joins (accept) or declines a group invitation. */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/invites/[id]">) {
  try {
    const { user } = await requireCustomer();
    const body = z.object({ accept: z.boolean() }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { accept }");
    const r = await answerGroupInvite(user.id, (await ctx.params).id, body.data.accept).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
