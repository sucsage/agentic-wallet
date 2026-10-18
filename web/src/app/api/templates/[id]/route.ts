import { z } from "zod";

import { HttpError, errorResponse, requireUser } from "@/lib/guard";
import { TemplateError, deleteTemplate, renameTemplate } from "@/lib/templates";

const wrap = (e: unknown) => {
  throw e instanceof TemplateError ? new HttpError(404, e.message) : e;
};

/** Renames a template. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/templates/[id]">) {
  try {
    const user = await requireUser();
    const body = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Give a name");
    return Response.json({ template: await renameTemplate(user.id, (await ctx.params).id, body.data.name).catch(wrap) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/templates/[id]">) {
  try {
    const user = await requireUser();
    await deleteTemplate(user.id, (await ctx.params).id).catch(wrap);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
