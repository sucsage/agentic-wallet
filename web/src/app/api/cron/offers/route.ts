import { getAddress } from "viem";

import { OFFER_DAYS, syncDeal } from "@/lib/bank/deals";
import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

export const maxDuration = 300;

/**
 * Daily (vercel.json crons): offers not signed within 14 days are withdrawn. syncDeal does the work
 * (it also runs whenever either side opens their deals); this catches deals nobody looks at.
 * With CRON_SECRET set, only Vercel's cron (Authorization: Bearer <secret>) may call it.
 */
export async function GET(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret ? req.headers.get("authorization") !== `Bearer ${secret}` : false) throw new HttpError(401, "Not allowed");
    if (!secret) rateLimit(req, "cron-offers", 6, 60 * 60 * 1000);
    const due = new Date(Date.now() - OFFER_DAYS * 86_400_000);
    const drafts = await db.dealDraft.findMany({
      where: { status: "FUNDED", dealId: { not: null }, offeredAt: { lt: due, gt: new Date(+due - 60 * 86_400_000) } },
      select: { dealId: true, walletAddress: true },
      take: 200,
    });
    let checked = 0;
    for (const d of drafts) {
      await syncDeal(getAddress(d.walletAddress), d.dealId!).catch((e) => console.error("cron offers", d.dealId, e));
      checked += 1;
    }
    return Response.json({ checked });
  } catch (err) {
    return errorResponse(err);
  }
}
