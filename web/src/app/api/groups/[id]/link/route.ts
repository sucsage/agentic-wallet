import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { SocialError, groupLink } from "@/lib/social";

/** A fresh join link for the group, shown as a QR to someone in person. */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/[id]/link">) {
  try {
    rateLimit(req, "group-link", 30, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const link = await groupLink(user.id, (await ctx.params).id).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ url: `${new URL(req.url).origin}/groups/join/${link.token}`, expiresAt: link.expiresAt });
  } catch (err) {
    return errorResponse(err);
  }
}
