import { HttpError, errorResponse, rateLimit, requireUser } from "@/lib/guard";
import { TemplateError, TemplateInput, listTemplates, saveTemplate } from "@/lib/templates";

/** The user's deal templates. */
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ templates: await listTemplates(user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Saves a deal (without its other party) as a template. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "template", 60, 60 * 60 * 1000);
    const user = await requireUser();
    const body = TemplateInput.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "Invalid template");
    const t = await saveTemplate(user.id, body.data).catch((e) => {
      throw e instanceof TemplateError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ template: t });
  } catch (err) {
    return errorResponse(err);
  }
}
