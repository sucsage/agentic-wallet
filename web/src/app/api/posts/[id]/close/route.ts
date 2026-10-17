import { HttpError, errorResponse, requireUser } from "@/lib/guard";
import { PostError, closePost } from "@/lib/public-posts";

/** Closes a public post: its link stops taking applications. */
export async function POST(_req: Request, ctx: RouteContext<"/api/posts/[id]/close">) {
  try {
    const user = await requireUser();
    await closePost(user.id, (await ctx.params).id).catch((e) => {
      throw e instanceof PostError ? new HttpError(404, e.message) : e;
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
