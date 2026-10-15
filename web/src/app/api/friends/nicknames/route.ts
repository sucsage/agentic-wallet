import { z } from "zod";

import { db } from "@/lib/db";
import { HttpError, errorResponse, requireUser } from "@/lib/guard";
import { friendLabels } from "@/lib/social";

/** Nicknames the AI agent learned for the user's contacts (by name; no addresses leave the server). */
export async function GET() {
  try {
    const user = await requireUser();
    const [rows, labels] = await Promise.all([
      db.contactAlias.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
      friendLabels(user.id),
    ]);
    return Response.json({
      nicknames: rows.map((r) => ({ id: r.id, nickname: r.alias, contact: labels.get(r.address.toLowerCase()) ?? "a former contact" })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const id = z.string().max(40).safeParse(new URL(req.url).searchParams.get("id"));
    if (!id.success) throw new HttpError(400, "Missing id");
    const { count } = await db.contactAlias.deleteMany({ where: { id: id.data, userId: user.id } });
    if (!count) throw new HttpError(404, "Nickname not found");
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
