import { getAddress } from "viem";

import { dealTerms } from "@/lib/bank/deals";
import { claimedInvites } from "@/lib/bank/invites";
import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/guard";
import { readFileDeals } from "@/lib/state";

/**
 * Seller invites linked to this account: the deals someone hired the user for through a link. Each
 * invite has its own wallet, so its deals are listed here too (the Deals page shows them with the
 * user's own deals; they open on the link's page).
 */
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await claimedInvites(user.id);
    const buyers = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const invites = await Promise.all(
      rows.map(async (r) => {
        const href = `/invite/id.${r.id}`;
        const wallet = getAddress(r.sellerWallet);
        const deals = await readFileDeals(wallet).catch(() => []);
        return {
          id: r.id,
          buyer: buyers.get(r.userId) ?? "a buyer",
          href,
          linkedAt: r.claimedAt,
          deals: await Promise.all(
            deals
              .filter((d) => d.role === "seller")
              .map(async (d) => {
                const terms = await dealTerms(d.id, d.counterparty, wallet).catch(() => null);
                return {
                  id: d.id,
                  title: terms?.title ?? `Deal #${d.id}`,
                  kind: terms?.kind ?? null,
                  total: d.total,
                  status: d.status,
                  offeredBy: d.offeredBy,
                  milestones: d.milestones.map((m) => ({ status: m.status, hasFile: m.hasFile })),
                  createdAt: terms?.createdAt ?? null,
                };
              }),
          ),
        };
      }),
    );
    return Response.json({ invites });
  } catch (err) {
    return errorResponse(err);
  }
}
