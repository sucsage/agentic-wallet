import { z } from "zod";

import { DealError, dealForWallet } from "@/lib/bank/deals";
import { inviteLinkFor } from "@/lib/bank/invites";
import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";
import { LinkAccessError, issueOtp, resetWithCode } from "@/lib/link-access";

const Body = z.discriminatedUnion("action", [
  /** A new one-time code, while the person has not set a password yet (e.g. the first one expired). */
  z.object({ action: z.literal("otp") }),
  /** The reset code the person got from "Forgot password" on their link: clears it and makes a new OTP. */
  z.object({ action: z.literal("reset"), code: z.string().max(12) }),
]);

/** The inviter manages access to the private link of the other side of this deal. */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/invite-access">) {
  try {
    rateLimit(req, "invite-access", 20, 60 * 60 * 1000);
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    const link = await inviteLinkFor(user.id, deal.counterparty, new URL(req.url).origin);
    if (!link) throw new HttpError(404, "You did not invite the other side of this deal");
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Choose an action");
    const invite = link.kind === "seller" ? await db.sellerInvite.findUniqueOrThrow({ where: { id: link.id } }) : await db.buyerInvite.findUniqueOrThrow({ where: { id: link.id } });
    try {
      if (body.data.action === "otp") {
        if (invite.accessPassword) throw new HttpError(409, "They already set a password. If they lost it, they press “Forgot password” on their link and send you the reset code.");
        return Response.json(await issueOtp(link.kind, invite));
      }
      return Response.json(await resetWithCode(link.kind, invite, body.data.code));
    } catch (e) {
      if (e instanceof LinkAccessError) throw new HttpError(400, e.message);
      throw e;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
