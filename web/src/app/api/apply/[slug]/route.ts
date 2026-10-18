import { HttpError, errorResponse, rateLimit } from "@/lib/guard";
import { ApplyInput, MAX_FILES, MAX_FILE_BYTES, PostError, apply, publicView } from "@/lib/public-posts";

const asHttp = (status: number) => (e: unknown) => {
  throw e instanceof PostError ? new HttpError(status, e.message) : e;
};

/** A public post (open call), for anyone with the link. */
export async function GET(req: Request, ctx: RouteContext<"/api/apply/[slug]">) {
  try {
    rateLimit(req, "apply-view", 240, 60 * 60 * 1000);
    return Response.json(await publicView((await ctx.params).slug).catch(asHttp(404)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Apply: multipart with name, contact, message, links (one per line), price, `portfolio` (one PDF, required) and up to 3 other `files`. No account needed. */
export async function POST(req: Request, ctx: RouteContext<"/api/apply/[slug]">) {
  try {
    rateLimit(req, "apply", 10, 60 * 60 * 1000);
    const form = await req.formData().catch(() => null);
    if (!form) throw new HttpError(400, "Send the form");
    // A field people never see: bots fill it in.
    if (String(form.get("website") ?? "")) return Response.json({ ok: true });
    const price = String(form.get("price") ?? "").replace(/[^\d.]/g, "");
    const body = ApplyInput.safeParse({
      name: form.get("name"),
      contact: form.get("contact"),
      message: form.get("message"),
      links: String(form.get("links") ?? "")
        .split(/\s*\n\s*|\s+/)
        .filter(Boolean),
      price: price ? Number(price) : null,
    });
    if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "Fill in your name, a contact and a message (10+ characters)");
    const portfolio = form.get("portfolio");
    if (!(portfolio instanceof File) || portfolio.size === 0) throw new HttpError(400, "Attach your portfolio as a PDF");
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_FILES || [portfolio, ...files].some((f) => f.size > MAX_FILE_BYTES)) throw new HttpError(413, "A portfolio and up to 3 other files, 4 MB each");
    const read = async (f: File, kind: "portfolio" | "other") => ({ name: f.name, mime: f.type, bytes: Buffer.from(await f.arrayBuffer()), kind });
    const out = await apply((await ctx.params).slug, body.data, [await read(portfolio, "portfolio"), ...(await Promise.all(files.map((f) => read(f, "other"))))]).catch(asHttp(400));
    return Response.json(out, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
