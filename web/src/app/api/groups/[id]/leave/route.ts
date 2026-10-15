import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, leaveGroup } from "@/lib/social";

/** A member leaves the group. */
export async function POST(_req: Request, ctx: RouteContext<"/api/groups/[id]/leave">) {
  try {
    const { user } = await requireCustomer();
    await leaveGroup(user.id, (await ctx.params).id).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
