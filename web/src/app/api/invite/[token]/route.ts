import { getSession } from "@/lib/auth";
import { after } from "next/server";
import { getAddress } from "viem";

import { disputeOf, disputeView } from "@/lib/bank/arbiter";
import { OFFER_DAYS, dealTerms, deliveryInfo, syncDeal } from "@/lib/bank/deals";
import { InviteError, claimInvite, inviteForRequest, inviteView, sweepInvite } from "@/lib/bank/invites";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";


// The arbiter may run after the response (three to five models for a dispute).
export const maxDuration = 300;
/**
 * The invited seller's page data, for whoever holds the link (no sign-in): the buyer's offers,
 * each milestone's state and delivery, earnings and the payout destination (masked). Opened by a
 * signed-in user, the invite is linked to their account (claimInvite).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/invite/[token]">) {
  try {
    rateLimit(req, "invite-view", 120, 60 * 60 * 1000);
    const userId = (await getSession())?.user.id ?? null;
    let invite = await inviteForRequest((await ctx.params).token, userId).catch((e) => {
      throw e instanceof InviteError ? new HttpError(404, e.message) : e;
    });
    // Opened signed in by someone who already has an account: link it to them automatically.
    let linkError: string | null = null;
    if (userId && invite.claimedByUserId !== userId && invite.userId !== userId) {
      invite = await claimInvite(invite, userId).catch((e) => {
        if (!(e instanceof InviteError)) throw e;
        linkError = e.message;
        return invite;
      });
    }
    const view = await inviteView(invite);
    const wallet = getAddress(invite.sellerWallet);
    after(async () => {
      await Promise.all(view.deals.map((d) => syncDeal(wallet, d.id).catch((e) => console.error("syncDeal", d.id, e))));
      // Also picks up a bank account the payment provider approved since the last visit.
      await sweepInvite(wallet).catch((e) => console.error("sweepInvite", e));
    });
    const deals = await Promise.all(
      view.deals.map(async (d) => {
        const terms = await dealTerms(d.id, d.counterparty, wallet);
        const milestones = (terms?.milestones ?? []) as { name: string; acceptance: string; fileTypes?: string[] }[];
        return {
          id: d.id,
          status: d.status,
          total: d.total,
          reviewHours: d.reviewHours,
          title: terms?.title ?? `Deal #${d.id}`,
          summary: terms?.summary ?? null,
          canAccept: d.status === "Proposed" && d.offeredBy === "them",
          guarantorRequired: terms?.guarantorsRequired === "both" || terms?.guarantorsRequired === "seller",
          guarantor: await db.dealGuarantor
            .findUnique({ where: { escrow_dealId_side: { escrow: config.fileEscrowOf(d.id), dealId: d.id, side: "seller" } }, select: { name: true, contact: true, relation: true, amount: true } })
            .then((g) => (g ? { ...g, amount: g.amount === null ? null : Number(g.amount) } : null)),
          offerExpiresAt: d.status === "Proposed" && terms ? new Date(+(terms.offeredAt ?? terms.updatedAt) + OFFER_DAYS * 86_400_000) : null,
          // What the buyer attached for the seller (a brief, references, a spec).
          files: terms ? await db.dealFile.findMany({ where: { draftId: terms.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, mime: true, size: true } }) : [],
          notes: (await db.dealNote.findMany({ where: { escrow: config.fileEscrowOf(d.id), dealId: d.id }, orderBy: { createdAt: "desc" }, take: 20 })).map((n) => ({ kind: n.kind, index: n.index, text: n.text, at: n.createdAt })),
          milestones: await Promise.all(
            d.milestones.map(async (m, i) => ({
              ...m,
              name: milestones[i]?.name ?? `Milestone ${i + 1}`,
              acceptance: milestones[i]?.acceptance ?? null,
              fileTypes: milestones[i]?.fileTypes ?? [],
              canDeliver: d.status === "Active" && (m.status === "Pending" || m.status === "Delivered"),
              delivery: await deliveryInfo(d.id, m.index),
              dispute: disputeView(await disputeOf(d.id, m.index)),
            })),
          ),
        };
      }),
    );
    return Response.json({ ...view, deals, linked: { toYou: !!userId && invite.claimedByUserId === userId, signedIn: !!userId, error: linkError } });
  } catch (err) {
    return errorResponse(err);
  }
}
