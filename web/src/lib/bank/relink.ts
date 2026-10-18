import "server-only";

import { db } from "../db";
import { LinkAccessError, consumeResetCode, issueOtp } from "../link-access";
import { rotateBuyerInviteLink } from "./buyer-invites";
import { rotateInviteLink } from "./invites";

export class RelinkError extends Error {}

/**
 * A new private link for the other side of a deal (the old one stops working), with a new one-time
 * code. Only with the code the link's holder got on their page ("Forgot password" / "Lost the
 * code?") and sent to the inviter: the inviter cannot replace a working link on their own. The one
 * exception is a link from before links were kept (its address is lost; nobody can be cut off by
 * replacing it).
 */
export async function relinkInvite(userId: string, link: { kind: "seller" | "buyer"; id: string }, code: string | undefined, origin: string) {
  const invite = link.kind === "seller" ? await db.sellerInvite.findFirst({ where: { id: link.id, userId } }) : await db.buyerInvite.findFirst({ where: { id: link.id, userId } });
  if (!invite) throw new RelinkError("You did not make this link");
  if (invite.tokenEnc) {
    if (!code?.trim()) throw new RelinkError("Ask them for the code: they press “Forgot password” (or “Lost the code?”) on their link and send it to you");
    try {
      await consumeResetCode(link.kind, invite, code);
    } catch (e) {
      throw e instanceof LinkAccessError ? new RelinkError(e.message) : e;
    }
  }
  const token = link.kind === "seller" ? await rotateInviteLink(userId, invite.id) : await rotateBuyerInviteLink(userId, invite.id);
  const otp = invite.accessRequired ? await issueOtp(link.kind, invite) : null;
  return { link: `${origin}/${link.kind === "seller" ? "invite" : "pay"}/${token}`, otp: otp?.otp ?? null, otpExpiresAt: otp?.expiresAt ?? null };
}
