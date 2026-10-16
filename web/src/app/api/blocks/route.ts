import { z } from "zod";

import { HttpError, errorResponse, rateLimit, requireUser } from "@/lib/guard";
import { SafetyError, blockUser, listBlocked } from "@/lib/safety";

export const maxDuration = 60;

/** People this user blocked. */
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ blocked: await listBlocked(user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Blocks a user: removes the contact and pending group invites, and takes them off the allow transfer list. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "block", 30, 60 * 60 * 1000);
    const user = await requireUser();
    const body = z.object({ userId: z.string().min(1).max(64) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Say who to block");
    const r = await blockUser(user.id, body.data.userId).catch((e) => {
      throw e instanceof SafetyError ? new HttpError(400, e.message) : e;
    });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
