import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, acceptFriend, removeFriend } from "@/lib/social";

const social = (e: unknown) => {
  throw e instanceof SocialError ? new HttpError(400, e.message) : e;
};

/** Accepts a pending request addressed to the signed-in user. */
export async function POST(_req: Request, ctx: RouteContext<"/api/friends/[id]">) {
  try {
    const { user } = await requireCustomer();
    const f = await acceptFriend(user.id, (await ctx.params).id).catch(social);
    return Response.json({ friendshipId: f.id, status: f.status });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Declines a request or unfriends. A friend who is an allowed payee stays one until removed in Policy. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/friends/[id]">) {
  try {
    const { user } = await requireCustomer();
    await removeFriend(user.id, (await ctx.params).id).catch(social);
    return Response.json({ removed: true });
  } catch (err) {
    return errorResponse(err);
  }
}
