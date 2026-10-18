import { z } from "zod";

import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { SocialError, ownerSetMember } from "@/lib/social";

const asHttp = (e: unknown) => {
  throw e instanceof SocialError ? new HttpError(400, e.message) : e;
};

/** The owner makes a member a signer or stops them signing (no vote). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/groups/[id]/members/[userId]">) {
  try {
    rateLimit(req, "group-owner", 60, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const { id, userId } = await ctx.params;
    const body = z.object({ canSign: z.boolean() }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Say whether they sign");
    await ownerSetMember(user.id, id, userId, { canSign: body.data.canSign }).catch(asHttp);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The owner removes a member (no vote). */
export async function DELETE(req: Request, ctx: RouteContext<"/api/groups/[id]/members/[userId]">) {
  try {
    rateLimit(req, "group-owner", 60, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const { id, userId } = await ctx.params;
    await ownerSetMember(user.id, id, userId, { remove: true }).catch(asHttp);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
