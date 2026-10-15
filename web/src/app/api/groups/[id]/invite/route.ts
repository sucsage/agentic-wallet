import { z } from "zod";

import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, inviteToGroup } from "@/lib/social";

/** Invites contacts to the group (they join by accepting). */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/[id]/invite">) {
  try {
    const { user } = await requireCustomer();
    const body = z.object({ members: z.array(z.object({ userId: z.string(), canSign: z.boolean() })).min(1).max(20) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { members: [{ userId, canSign }] }");
    await inviteToGroup(user.id, (await ctx.params).id, body.data.members).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
