import "server-only";

import { db } from "../db";

/** Days a finished deal's link still opens (to download the file, see the outcome, keep a receipt). */
export const LINK_GRACE_DAYS = 7;

const SETTLED = new Set(["Released", "Refunded", "Split"]);

/** A deal nobody can move any more: cancelled, or every milestone paid out or refunded. */
export const dealFinished = (d: { status: string; milestones: { status: string }[] }) => d.status === "Cancelled" || (d.status === "Active" && d.milestones.every((m) => SETTLED.has(m.status)));

/**
 * A private link whose deals are all finished closes LINK_GRACE_DAYS later: it was used, and an
 * old link left working is a risk. An invited seller's link waits for the payout to be set (their
 * earnings go there). Returns when it closes (null while something is still open).
 */
export async function closeFinishedLink(kind: "seller" | "buyer", invite: { id: string; expiresAt: Date; finishedAt: Date | null; payoutSetAt?: Date | null }, deals: { status: string; milestones: { status: string }[] }[]): Promise<Date | null> {
  if (invite.finishedAt) return invite.expiresAt;
  if (!deals.length || !deals.every(dealFinished)) return null;
  if (kind === "seller" && !invite.payoutSetAt) return null;
  const closes = new Date(Math.min(invite.expiresAt.getTime(), Date.now() + LINK_GRACE_DAYS * 86_400_000));
  const data = { finishedAt: new Date(), expiresAt: closes };
  if (kind === "seller") await db.sellerInvite.update({ where: { id: invite.id }, data });
  else await db.buyerInvite.update({ where: { id: invite.id }, data });
  return closes;
}
