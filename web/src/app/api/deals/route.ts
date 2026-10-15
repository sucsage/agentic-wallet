import { after } from "next/server";

import { dealTerms, syncDeal } from "@/lib/bank/deals";
import { draftView, listDrafts } from "@/lib/bank/drafts";
import { errorResponse, requireBankWallet } from "@/lib/guard";
import { friendLabels } from "@/lib/social";
import { readFileDeals } from "@/lib/state";

/**
 * The user's file deals (buying and selling) and open drafts. The demo seller and bank settlement
 * advance in the background after the response, so the next read shows their progress.
 */
export async function GET() {
  try {
    const { user, wallet } = await requireBankWallet();
    const [deals, drafts] = await Promise.all([readFileDeals(wallet), listDrafts(user.id, wallet)]);
    after(async () => {
      for (const d of deals) await syncDeal(wallet, d.id).catch((e) => console.error("syncDeal", d.id, e));
    });
    // Titles come from the buyer's draft, so a seller sees the same name for the deal.
    const friends = await friendLabels(user.id);
    const titles = await Promise.all(deals.map((d) => dealTerms(d.id, d.role === "buyer" ? wallet : d.counterparty, d.role === "seller" ? wallet : d.counterparty)));
    return Response.json({
      deals: deals.map((d, i) => ({
        ...d,
        title: titles[i]?.title ?? null,
        kind: titles[i]?.kind ?? "HIRE",
        counterpartyLabel: friends.get(d.counterparty.toLowerCase()) ?? d.counterpartyLabel,
      })),
      drafts: await Promise.all(drafts.filter((d) => d.status !== "FUNDED").map((d) => draftView(d))),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
