import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { SocialError, groupLinkInfo, joinByLink } from "@/lib/social";

/** What a join link is for, before joining. */
export async function GET(req: Request, ctx: RouteContext<"/api/groups/join/[token]">) {
  try {
    rateLimit(req, "group-join", 60, 60 * 60 * 1000);
    await requireCustomer();
    const { view } = await groupLinkInfo((await ctx.params).token).catch((e) => {
      throw e instanceof SocialError ? new HttpError(404, e.message) : e;
    });
    return Response.json(view);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Joins the group as a member (not a signer). */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/join/[token]">) {
  try {
    rateLimit(req, "group-join", 60, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const r = await joinByLink(user.id, (await ctx.params).token).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
