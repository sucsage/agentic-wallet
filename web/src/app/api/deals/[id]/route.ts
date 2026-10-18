import { isPdfDelivery } from "@/lib/file-types";
import { after } from "next/server";

import { disputeOf, disputeView } from "@/lib/bank/arbiter";
import { planOf, planView } from "@/lib/bank/payment-plans";
import { revisionsAllowed } from "@/lib/file-types";
import { dueDates } from "@/lib/bank/milestone-due";
import { DealError, OFFER_DAYS, dealForWallet, dealTerms, deliveryInfo, demoDeliverable, isSiteDelivery, syncDeal } from "@/lib/bank/deals";
import { deliveryOf, draftView } from "@/lib/bank/drafts";
import { inviteLinkFor } from "@/lib/bank/invites";
import { roleAddresses } from "@/lib/chain";
import { config, explorerAddress } from "@/lib/config";
import { db } from "@/lib/db";
import { HttpError, errorResponse, requireBankWallet } from "@/lib/guard";
import { friendLabels } from "@/lib/social";


// The arbiter may run after the response (three to five models for a dispute).
export const maxDuration = 300;
/** What the user can do with a milestone now (the contract has the last word). */
function moves(role: "buyer" | "seller", dealStatus: string, status: string, deadline: number): string[] {
  if (dealStatus !== "Active") return [];
  const open = Date.now() / 1000 <= deadline;
  if (role === "buyer") {
    if (status === "Delivered") return open ? ["approve", "dispute"] : ["approve"];
    if (status === "KeyReleased") return open ? ["dispute"] : [];
    if (status === "Approved") return open ? [] : ["reclaim"];
    return [];
  }
  // Seller: key release and claim happen on their own; delivering and refunding are the user's.
  if (status === "Pending") return ["deliver", "refund"];
  if (status === "Delivered") return ["deliver", "refund"];
  if (status === "Approved" || status === "KeyReleased") return ["refund"];
  return [];
}

/** One deal, from either side: milestones, deadlines, moves, deliveries and its off-chain terms. */
export async function GET(req: Request, ctx: RouteContext<"/api/deals/[id]">) {
  try {
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 0) throw new HttpError(400, "Invalid deal id");
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    after(() => syncDeal(wallet, id).catch((e) => console.error("syncDeal", id, e)));
    const buyer = deal.role === "buyer" ? wallet : deal.counterparty;
    const draft = await dealTerms(id, buyer, deal.role === "seller" ? wallet : deal.counterparty);
    const terms = draft ? await draftView(draft) : null;
    const demoSeller = deal.role === "buyer" && deal.counterparty === roleAddresses().contractor;
    const declines = deal.status === "Proposed" ? await db.declinedOffer.findMany({ where: { escrow: config.fileEscrowOf(id), dealId: id } }) : [];
    const notes = await db.dealNote.findMany({ where: { escrow: config.fileEscrowOf(id), dealId: id }, orderBy: { createdAt: "desc" }, take: 20 });
    const witnesses = await db.dealWitness.findMany({ where: { escrow: config.fileEscrowOf(id), dealId: id } });
    const guarantors = await db.dealGuarantor.findMany({ where: { escrow: config.fileEscrowOf(id), dealId: id } });
    const changeCounts = await db.dealNote.groupBy({ by: ["index"], where: { escrow: config.fileEscrowOf(id), dealId: id, kind: "CHANGES" }, _count: { _all: true } });
    const [deliveries, friends, disputes, invite, dues] = await Promise.all([
      Promise.all(deal.milestones.map((m) => deliveryInfo(id, m.index))),
      friendLabels(user.id),
      Promise.all(deal.milestones.map((m) => disputeOf(id, m.index))),
      // The other side has no account and this user invited them: their private link.
      inviteLinkFor(user.id, deal.counterparty, new URL(req.url).origin),
      dueDates(wallet, id).catch(() => []),
    ]);
    return Response.json({
      ...deal,
      counterpartyLabel: friends.get(deal.counterparty.toLowerCase()) ?? deal.counterpartyLabel,
      invite,
      witnesses: witnesses.map((w) => ({ side: w.side, name: w.name, contact: w.contact, mine: w.side === deal.role })),
      guarantors: guarantors.map((g) => ({ side: g.side, name: g.name, contact: g.contact, relation: g.relation, amount: g.amount === null ? null : Number(g.amount), mine: g.side === deal.role })),
      // An offer must be signed (accepted) within 14 days, or it is withdrawn.
      offerExpiresAt: deal.status === "Proposed" && draft ? new Date(+(draft.offeredAt ?? draft.updatedAt) + OFFER_DAYS * 86_400_000) : null,
      rules: draft?.rules ?? null,
      guarantorsRequired: draft?.guarantorsRequired ?? null,
      // Split payment (แบ่งจ่าย): the parts, what is paid, and whether this user is the one paying.
      paymentPlan: await (async () => {
        const parts = draft ? planOf(draft) : null;
        if (!draft || !parts) return null;
        const plan = await db.paymentPlan.findUnique({ where: { draftId: draft.id } });
        return { ...planView(parts, plan), payer: plan ? plan.payerUserId === user.id : deal.role === "buyer" };
      })(),
      replacedBy: (await db.dealDraft.findFirst({ where: { replacesDealId: id, status: "FUNDED" }, select: { dealId: true } }))?.dealId ?? null,
      title: terms?.title ?? `File deal #${id}`,
      summary: terms?.summary ?? null,
      kind: terms?.kind ?? "HIRE",
      shipTo: terms?.shipTo ?? null,
      escrow: explorerAddress(config.fileEscrowOf(id)),
      demoSeller,
      // The side that made the offer may withdraw it; the other side accepts it (a buyer pays in then).
      canCancel: deal.status === "Proposed" && deal.offeredBy === "me",
      canAccept: deal.status === "Proposed" && deal.offeredBy === "them",
      // "me": this user turned the offer down; "them": the other side did (the creator should withdraw it).
      // Requests from the buyer: changes to a delivery, or a revised offer.
      notes: notes.map((n) => ({ kind: n.kind, index: n.index, text: n.text, at: n.createdAt })),
      declined: declines.some((d) => d.userId === user.id) ? "me" : declines.length > 0 ? "them" : null,
      milestones: deal.milestones.map((m, i) => ({
        ...m,
        due: dues[i] ?? null,
        name: terms?.milestones[i]?.name ?? `Milestone ${i + 1}`,
        acceptance: terms?.milestones[i]?.acceptance ?? null,
        delivers: m.hasFile ? "file" : deliveryOf(terms?.milestones[i]),
        // Images and PDFs (first pages) get a watermarked preview the buyer can see before approving.
        canPreview: Boolean(deliveries[i]?.mime?.startsWith("image/") || isPdfDelivery(deliveries[i])),
        previewPdf: isPdfDelivery(deliveries[i]),
        // A web page (.html) is tried in a browser / phone mockup instead.
        canMockup: isSiteDelivery(deliveries[i]),
        deposit: terms?.milestones[i]?.deposit === true,
        fileTypes: terms?.milestones[i]?.fileTypes ?? [],
        // Rounds of changes agreed for this milestone, and how many the buyer asked for so far.
        revisions: revisionsAllowed(terms?.milestones[i]?.revisions),
        revisionsUsed: changeCounts.find((c) => c.index === m.index)?._count._all ?? 0,
        moves: moves(deal.role, deal.status, m.status, m.deadline),
        delivery: deliveries[i],
        dispute: disputeView(disputes[i]),
        // A file can be downloaded by the seller any time, by the buyer once the key is released.
        canDownload:
          Boolean(deliveries[i]?.fileName) && (deal.role === "seller" || m.status === "KeyReleased" || m.status === "Released" || m.status === "Split"),
        // Demo contractor deals have no real file: a sample text stands in once the key is out.
        deliverable: ["KeyReleased", "Released", "Split"].includes(m.status) && demoSeller ? demoDeliverable(id, i) : null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
