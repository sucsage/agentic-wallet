import { getAddress } from "viem";

import { BuyerInviteError, buyerInviteByToken } from "@/lib/bank/buyer-invites";
import { DealError, SITE_PREVIEW_HEADERS, deliverySite } from "@/lib/bank/deals";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

/** The invited buyer tries a delivered web page in a device mockup before approving. */
export async function GET(req: Request, ctx: RouteContext<"/api/pay/[token]/site/[dealId]/[index]">) {
  try {
    rateLimit(req, "pay-site", 120, 60 * 60 * 1000);
    const p = await ctx.params;
    const invite = await buyerInviteByToken(p.token).catch((e) => {
      throw e instanceof BuyerInviteError ? new HttpError(404, e.message) : e;
    });
    const id = Number(p.dealId);
    const index = Number(p.index);
    if (!Number.isInteger(id) || !Number.isInteger(index)) throw new HttpError(400, "Invalid request");
    const html = await deliverySite(getAddress(invite.buyerWallet), id, index).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    return new Response(html, { headers: SITE_PREVIEW_HEADERS });
  } catch (err) {
    return errorResponse(err);
  }
}
