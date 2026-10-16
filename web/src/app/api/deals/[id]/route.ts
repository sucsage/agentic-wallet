import { after } from "next/server";

import { disputeOf, disputeView } from "@/lib/bank/arbiter";
import { DealError, dealForWallet, dealTerms, deliveryInfo, demoDeliverable, syncDeal } from "@/lib/bank/deals";
import { deliveryOf, draftView } from "@/lib/bank/drafts";
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
export async function GET(_req: Request, ctx: RouteContext<"/api/deals/[id]">) {
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
    const [deliveries, friends, disputes] = await Promise.all([
      Promise.all(deal.milestones.map((m) => deliveryInfo(id, m.index))),
      friendLabels(user.id),
      Promise.all(deal.milestones.map((m) => disputeOf(id, m.index))),
    ]);
    return Response.json({
      ...deal,
      counterpartyLabel: friends.get(deal.counterparty.toLowerCase()) ?? deal.counterpartyLabel,
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
        name: terms?.milestones[i]?.name ?? `Milestone ${i + 1}`,
        acceptance: terms?.milestones[i]?.acceptance ?? null,
        delivers: m.hasFile ? "file" : deliveryOf(terms?.milestones[i]),
        // Images get a watermarked preview the buyer can see before approving.
        canPreview: Boolean(deliveries[i]?.mime?.startsWith("image/")),
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
