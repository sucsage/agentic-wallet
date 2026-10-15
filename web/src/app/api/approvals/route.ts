import { dealTerms } from "@/lib/bank/deals";
import { draftView, listDrafts } from "@/lib/bank/drafts";
import { errorResponse, requireBankWallet } from "@/lib/guard";
import { friendLabels, pendingVotes } from "@/lib/social";
import { readWallet } from "@/lib/state";

/**
 * Everything waiting for the signed-in user: drafts to approve & lock (Tier 1), deliveries to
 * review, group deals to vote on, and any open on-chain proposals of their wallet.
 */
export async function GET() {
  try {
    const { user, wallet } = await requireBankWallet();
    const [drafts, state, votes, friends] = await Promise.all([
      listDrafts(user.id, wallet),
      readWallet(wallet),
      pendingVotes(user.id),
      friendLabels(user.id),
    ]);
    const titles = new Map(drafts.filter((d) => d.dealId !== null).map((d) => [d.dealId!, d.title]));
    const reviews = state.fileDeals
      .filter((d) => d.role === "buyer" && d.status === "Active")
      .flatMap((d) =>
        d.milestones
          .filter((m) => m.status === "Delivered")
          .map((m) => ({
            dealId: d.id,
            title: titles.get(d.id) ?? `File deal #${d.id}`,
            index: m.index,
            amount: m.amount,
            reviewUntil: m.deadline,
            // Within the agent's caps the agent can approve on its own (Tier 2); above, it is Tier 1.
            tier: Number(m.amount) <= Number(state.session.maxPerTx) ? 2 : 1,
          })),
      );
    // As a seller: offers waiting for acceptance and milestones waiting for delivery.
    const selling = state.fileDeals.filter((d) => d.role === "seller" && d.status !== "Cancelled");
    const sellerTitles = await Promise.all(selling.map((d) => dealTerms(d.id, d.counterparty, wallet)));
    type SellerTodo = { dealId: number; title: string; index: number | null; amount: string; step: "accept" | "deliver" };
    const toDeliver = selling.flatMap((d, k): SellerTodo[] => {
      const title = sellerTitles[k]?.title ?? `File deal #${d.id}`;
      if (d.status === "Proposed") return d.offeredBy === "them" ? [{ dealId: d.id, title, index: null, amount: d.total, step: "accept" }] : [];
      const next = d.milestones.find((m) => m.status === "Pending");
      return next ? [{ dealId: d.id, title, index: next.index, amount: next.amount, step: "deliver" }] : [];
    });
    // As a buyer: sellers' offers waiting for acceptance; accepting debits the bank and locks it.
    const incoming = state.fileDeals.filter((d) => d.role === "buyer" && d.status === "Proposed" && d.offeredBy === "them");
    const offerTitles = await Promise.all(incoming.map((d) => dealTerms(d.id, wallet, d.counterparty)));
    const offers = incoming.map((d, k) => ({
      dealId: d.id,
      title: offerTitles[k]?.title ?? `File deal #${d.id}`,
      amount: d.total,
      seller: d.counterparty,
      sellerLabel: friends.get(d.counterparty.toLowerCase()) ?? d.counterpartyLabel,
    }));
    const items = {
      offers,
      sellerTodo: toDeliver,
      drafts: await Promise.all(
        drafts.filter((d) => d.status === "DRAFT").map((d) => draftView(d, friends.get((d.side === "SELL" ? (d.buyer ?? "") : d.seller).toLowerCase()))),
      ),
      reviews,
      groupVotes: votes,
      proposals: state.proposals.filter((p) => p.status === "open"),
    };
    const count =
      items.offers.length + items.drafts.length + items.reviews.length + items.groupVotes.length + items.proposals.length + items.sellerTodo.length;
    return Response.json({ count, ...items });
  } catch (err) {
    return errorResponse(err);
  }
}
