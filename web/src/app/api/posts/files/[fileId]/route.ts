import { fileResponse } from "@/lib/deal-files";
import { HttpError, errorResponse, requireUser } from "@/lib/guard";
import { PostError, applicationFile } from "@/lib/public-posts";

/** A file an applicant sent, for the post's owner only (images and PDFs open, anything else downloads; nothing runs). */
export async function GET(_req: Request, ctx: RouteContext<"/api/posts/files/[fileId]">) {
  try {
    const user = await requireUser();
    const f = await applicationFile(user.id, (await ctx.params).fileId).catch((e) => {
      throw e instanceof PostError ? new HttpError(404, e.message) : e;
    });
    return fileResponse(f);
  } catch (err) {
    return errorResponse(err);
  }
}
