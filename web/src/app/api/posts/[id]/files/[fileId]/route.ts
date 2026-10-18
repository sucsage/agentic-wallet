import { fileResponse } from "@/lib/deal-files";
import { HttpError, errorResponse, requireUser } from "@/lib/guard";
import { PostError, ownerPostFile, removePostFile } from "@/lib/public-posts";

/** The owner opens a document they attached (PDFs and images in place). */
export async function GET(_req: Request, ctx: RouteContext<"/api/posts/[id]/files/[fileId]">) {
  try {
    const user = await requireUser();
    const { id, fileId } = await ctx.params;
    return fileResponse(
      await ownerPostFile(user.id, id, fileId).catch((e) => {
        throw e instanceof PostError ? new HttpError(404, e.message) : e;
      }),
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/posts/[id]/files/[fileId]">) {
  try {
    const user = await requireUser();
    const { id, fileId } = await ctx.params;
    await removePostFile(user.id, id, fileId).catch((e) => {
      throw e instanceof PostError ? new HttpError(404, e.message) : e;
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
