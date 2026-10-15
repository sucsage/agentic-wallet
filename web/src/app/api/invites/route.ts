import { z } from "zod";

import { InviteError, createInvite, listInvites } from "@/lib/bank/invites";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

export const maxDuration = 120;

/** Sellers this user invited by link (the links themselves are not stored, only their hashes). */
export async function GET() {
  try {
    const { user } = await requireBankWallet();
    const invites = await listInvites(user.id);
    return Response.json({
      invites: invites.map((i) => ({
        id: i.id,
        name: i.name,
        wallet: i.sellerWallet,
        payoutSet: Boolean(i.payoutSetAt),
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Invites someone without an account to sell to this user. Creates their wallet, makes it a payee
 * (an owner action: this click is the approval) and returns the link, shown only now.
 */
export async function POST(req: Request) {
  try {
    rateLimit(req, "invite", 10, 60 * 60 * 1000);
    const { user, wallet } = await requireBankWallet();
    const body = z.object({ name: z.string().min(2).max(80) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { name }");
    const { invite, token, payee } = await createInvite(user.id, wallet, body.data.name).catch((e) => {
      throw e instanceof InviteError ? new HttpError(400, e.message) : e;
    });
    return Response.json({
      invite: { id: invite.id, name: invite.name, wallet: invite.sellerWallet, expiresAt: invite.expiresAt },
      link: `${new URL(req.url).origin}/invite/${token}`,
      payee,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
