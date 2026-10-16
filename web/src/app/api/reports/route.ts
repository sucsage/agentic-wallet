import { z } from "zod";

import { HttpError, errorResponse, rateLimit, requireUser } from "@/lib/guard";
import { REPORT_REASONS, SafetyError, reportUser } from "@/lib/safety";

export const maxDuration = 60;

const Body = z.object({
  userId: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS),
  details: z.string().max(2000).default(""),
  block: z.boolean().default(false),
});

/** Reports a contact to the admins, optionally blocking them too. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "report", 20, 60 * 60 * 1000);
    const user = await requireUser();
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Choose a reason");
    const { userId, reason, details, block } = body.data;
    const r = await reportUser(user.id, userId, reason, details, block).catch((e) => {
      throw e instanceof SafetyError ? new HttpError(400, e.message) : e;
    });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
