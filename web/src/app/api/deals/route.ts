import { after } from "next/server";

import { syncDeal } from "@/lib/bank/deals";
import { draftView, listDrafts } from "@/lib/bank/drafts";
import { errorResponse, requireBankWallet } from "@/lib/guard";
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
    const byDeal = new Map(drafts.filter((d) => d.dealId !== null).map((d) => [d.dealId!, d]));
    return Response.json({
      deals: deals.map((d) => ({ ...d, title: byDeal.get(d.id)?.title ?? null })),
      drafts: await Promise.all(drafts.filter((d) => d.status !== "FUNDED").map((d) => draftView(d))),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
