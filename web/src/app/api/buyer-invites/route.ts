import { z } from "zod";

import { BuyerInviteError, createBuyerInvite } from "@/lib/bank/buyer-invites";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";
import { publicOrigin } from "@/lib/origins";

export const maxDuration = 60;

/** The seller invites a buyer who has no account; returns the private link (shown once). */
export async function POST(req: Request) {
  try {
    rateLimit(req, "buyer-invite", 20, 60 * 60 * 1000);
    const { user, wallet } = await requireBankWallet();
    const body = z.object({ name: z.string().min(2).max(80) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Enter the buyer's name");
    const { invite, token } = await createBuyerInvite(user.id, wallet, body.data.name).catch((e) => {
      throw e instanceof BuyerInviteError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ name: `${invite.name} (invited buyer)`, link: `${publicOrigin(req)}/pay/${token}`, expiresAt: invite.expiresAt }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
