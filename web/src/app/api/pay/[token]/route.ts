import { getAddress } from "viem";
import { z } from "zod";

import {
  BuyerInviteError,
  approveAsInvitedBuyer,
  buyerInviteForRequest,
  buyerInviteView,
  confirmBuyerPayment,
  payOffer,
  startBuyerPayment,
} from "@/lib/bank/buyer-invites";
import { DealError } from "@/lib/bank/deals";
import { closeFinishedLink } from "@/lib/bank/link-end";
import { dueDates } from "@/lib/bank/milestone-due";
import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";
import { publicOrigin } from "@/lib/origins";

export const maxDuration = 120;

const asHttp = (status: number) => (e: unknown) => {
  throw e instanceof BuyerInviteError || e instanceof DealError ? new HttpError(status, e.message) : e;
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { headers: { "content-type": "application/json" } });

/** The invited buyer's page data, for whoever holds the link (no sign-in). */
export async function GET(req: Request, ctx: RouteContext<"/api/pay/[token]">) {
  try {
    rateLimit(req, "pay-view", 120, 60 * 60 * 1000);
    const invite = await buyerInviteForRequest((await ctx.params).token).catch(asHttp(404));
    const view = await buyerInviteView(invite);
    // Every deal finished: the link closes a week later (it was used; an old link left open is a risk).
    const deals = (view as { deals?: { status: string; milestones: { status: string }[] }[] }).deals ?? [];
    const closesAt = await closeFinishedLink("buyer", invite, deals).catch((e) => (console.error("closeFinishedLink", e), null));
    const buyer = getAddress(invite.buyerWallet);
    const withDue = await Promise.all(
      (view.deals as { id: number; milestones: { index: number }[] }[]).map(async (d) => {
        const dues = await dueDates(buyer, d.id).catch(() => []);
        return { ...d, milestones: d.milestones.map((m) => ({ ...m, due: dues.find((x) => x.index === m.index) ?? null })) };
      }),
    );
    return json({ ...view, deals: withDue, closesAt });
  } catch (err) {
    return errorResponse(err);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("checkout"), dealId: z.number().int().min(0) }),
  z.object({ action: z.literal("confirm"), dealId: z.number().int().min(0), sessionId: z.string().max(200) }),
  z.object({ action: z.literal("pay"), dealId: z.number().int().min(0) }),
  z.object({ action: z.literal("approve"), dealId: z.number().int().min(0), index: z.number().int().min(0).max(20) }),
  // The buyer writes their own name (the seller only guessed it when inviting).
  z.object({ action: z.literal("name"), name: z.string().trim().min(2).max(80) }),
]);

/** Pay an offer by card (Checkout, then confirm), pay from the balance, or approve a delivery. */
export async function POST(req: Request, ctx: RouteContext<"/api/pay/[token]">) {
  try {
    rateLimit(req, "pay-action", 30, 60 * 60 * 1000);
    const { token } = await ctx.params;
    const invite = await buyerInviteForRequest(token).catch(asHttp(404));
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Invalid request");
    const b = body.data;
    if (b.action === "name") {
      const clean = b.name.replace(/\s+/g, " ").slice(0, 80);
      await db.buyerInvite.update({ where: { id: invite.id }, data: { name: clean } });
      return json({ name: clean });
    }
    if (b.action === "checkout") return json(await startBuyerPayment(invite, token, b.dealId, publicOrigin(req)).catch(asHttp(400)));
    if (b.action === "confirm") return json(await confirmBuyerPayment(invite, b.sessionId, b.dealId).catch(asHttp(400)));
    if (b.action === "pay") return json(await payOffer(invite, b.dealId).catch(asHttp(400)));
    return json(await approveAsInvitedBuyer(invite, b.dealId, b.index).catch(asHttp(400)));
  } catch (err) {
    return errorResponse(err);
  }
}
