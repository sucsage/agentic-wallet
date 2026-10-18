import { fileResponse } from "@/lib/deal-files";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";
import { PostError, publicPostFile } from "@/lib/public-posts";

/** A document the poster attached (rules, a brief), for anyone with the post's link. PDFs open in place. */
export async function GET(req: Request, ctx: RouteContext<"/api/apply/[slug]/files/[fileId]">) {
  try {
    rateLimit(req, "apply-file", 240, 60 * 60 * 1000);
    const { slug, fileId } = await ctx.params;
    return fileResponse(
      await publicPostFile(slug, fileId).catch((e) => {
        throw e instanceof PostError ? new HttpError(404, e.message) : e;
      }),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
