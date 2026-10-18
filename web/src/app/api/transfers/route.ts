import { z } from "zod";

import { SendError, sendToFriends } from "@/lib/bank/send";
import { HttpError, actingAs, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

const Body = z.object({
  recipients: z.array(z.object({ userId: z.string().min(1).max(40), amount: z.number().positive() })).min(1).max(20),
  requestId: z.string().uuid(),
});

/** Sends money from the user's own wallet to one or several contacts at once (all or nothing). */
export async function POST(req: Request) {
  try {
    rateLimit(req, "send", 30, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    // A company's or group's money moves only by its signers' vote: Groups → Pay out to members.
    if (await actingAs(user.id)) throw new HttpError(400, "Switch to Personal to send from your own wallet. A shared account pays out by its signers' vote (Groups → Pay out to members).");
    const body = Body.safeParse(await req.json());
    if (!body.success) throw new HttpError(400, "Choose people and amounts");
    const r = await sendToFriends(user.id, body.data.recipients, body.data.requestId).catch((e) => {
      throw e instanceof SendError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ ok: true, total: r.total.toString(), already: r.already });
  } catch (err) {
    return errorResponse(err);
  }
}
