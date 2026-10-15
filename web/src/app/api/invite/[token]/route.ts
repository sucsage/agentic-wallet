import { after } from "next/server";
import { getAddress } from "viem";

import { dealTerms, deliveryInfo, syncDeal } from "@/lib/bank/deals";
import { InviteError, inviteByToken, inviteView } from "@/lib/bank/invites";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

/**
 * The invited seller's page data, for whoever holds the link (no sign-in): the buyer's offers,
 * each milestone's state and delivery, earnings and the payout destination (masked).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/invite/[token]">) {
  try {
    rateLimit(req, "invite-view", 120, 60 * 60 * 1000);
    const invite = await inviteByToken((await ctx.params).token).catch((e) => {
      throw e instanceof InviteError ? new HttpError(404, e.message) : e;
    });
    const view = await inviteView(invite);
    const wallet = getAddress(invite.sellerWallet);
    after(() => Promise.all(view.deals.map((d) => syncDeal(wallet, d.id).catch((e) => console.error("syncDeal", d.id, e)))));
    const deals = await Promise.all(
      view.deals.map(async (d) => {
        const terms = await dealTerms(d.id, d.counterparty, wallet);
        const milestones = (terms?.milestones ?? []) as { name: string; acceptance: string }[];
        return {
          id: d.id,
          status: d.status,
          total: d.total,
          reviewHours: d.reviewHours,
          title: terms?.title ?? `Deal #${d.id}`,
          summary: terms?.summary ?? null,
          canAccept: d.status === "Proposed" && d.offeredBy === "them",
          milestones: await Promise.all(
            d.milestones.map(async (m, i) => ({
              ...m,
              name: milestones[i]?.name ?? `Milestone ${i + 1}`,
              acceptance: milestones[i]?.acceptance ?? null,
              canDeliver: d.status === "Active" && (m.status === "Pending" || m.status === "Delivered"),
              delivery: await deliveryInfo(d.id, m.index),
            })),
          ),
        };
      }),
    );
    return Response.json({ ...view, deals });
  } catch (err) {
    return errorResponse(err);
  }
}
