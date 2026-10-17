import { HttpError, errorResponse, rateLimit, requireUser } from "@/lib/guard";
import { PostError, recommend } from "@/lib/public-posts";

export const maxDuration = 120;

/** The AI ranks the applications for the owner. */
export async function POST(req: Request, ctx: RouteContext<"/api/posts/[id]/recommend">) {
  try {
    rateLimit(req, "post-recommend", 20, 60 * 60 * 1000);
    const user = await requireUser();
    const ranking = await recommend(user.id, (await ctx.params).id).catch((e) => {
      throw e instanceof PostError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ ranking });
  } catch (err) {
    return errorResponse(err);
  }
}
