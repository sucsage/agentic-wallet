import { getSession } from "@/lib/auth";
import { z } from "zod";

import { InviteError, PAYOUT_BANKS, inviteForRequest, setPayout } from "@/lib/bank/invites";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

const Body = z.discriminatedUnion("method", [
  z.object({ method: z.literal("MOCKBANK"), accountNo: z.string().max(40), name: z.string().max(120) }),
  z.object({
    method: z.literal("PROMPTPAY"),
    promptPayId: z.string().max(40).optional(),
    qr: z.string().max(512).optional(),
    name: z.string().max(120),
  }),
  z.object({ method: z.literal("BANK"), bank: z.enum(PAYOUT_BANKS), accountNo: z.string().max(40), name: z.string().max(120) }),
]);

/** Where the invited seller is paid: set once, then locked. Name checks happen in setPayout. */
export async function POST(req: Request, ctx: RouteContext<"/api/invite/[token]/payout">) {
  try {
    // Tight: a name check must not become a way to look up who owns an account number.
    rateLimit(req, "invite-payout", 8, 60 * 60 * 1000);
    const invite = await inviteForRequest((await ctx.params).token, (await getSession())?.user.id ?? null).catch((e) => {
      throw e instanceof InviteError ? new HttpError(404, e.message) : e;
    });
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Choose how to be paid and fill in every field");
    const updated = await setPayout(invite, body.data).catch((e) => {
      throw e instanceof InviteError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ ok: true, payoutName: updated.payoutName, method: updated.payoutMethod });
  } catch (err) {
    return errorResponse(err);
  }
}
