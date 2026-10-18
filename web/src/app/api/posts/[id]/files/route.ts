import { HttpError, errorResponse, rateLimit, requireUser } from "@/lib/guard";
import { MAX_FILE_BYTES, PostError, addPostFile } from "@/lib/public-posts";

/** The owner attaches a document for applicants (rules, a brief): multipart `file`, up to 5 per post. */
export async function POST(req: Request, ctx: RouteContext<"/api/posts/[id]/files">) {
  try {
    rateLimit(req, "post-file", 30, 60 * 60 * 1000);
    const user = await requireUser();
    const f = (await req.formData().catch(() => null))?.get("file");
    if (!(f instanceof File) || !f.size) throw new HttpError(400, "Choose a file");
    if (f.size > MAX_FILE_BYTES) throw new HttpError(413, "Files up to 4 MB");
    const file = await addPostFile(user.id, (await ctx.params).id, { name: f.name, mime: f.type, bytes: Buffer.from(await f.arrayBuffer()) }).catch((e) => {
      throw e instanceof PostError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ file });
  } catch (err) {
    return errorResponse(err);
  }
}
