import { z } from "zod";

import { HttpError, errorResponse, requireUser } from "@/lib/guard";
import { prefsOf, setPrefs } from "@/lib/prefs";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await prefsOf(user.id));
  } catch (err) {
    return errorResponse(err);
  }
}

const Patch = z.object({
  showAlso: z.enum(["THB", "CNY"]).nullable().optional(),
  aiChat: z.boolean().optional(),
  cardCover: z.boolean().optional(),
});

/** Saves Profile & Privacy choices. */
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const body = Patch.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Invalid preferences");
    return Response.json(await setPrefs(user.id, body.data));
  } catch (err) {
    return errorResponse(err);
  }
}
