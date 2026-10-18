import { getAddress } from "viem";

import { BuyerInviteError, buyerInviteForRequest } from "@/lib/bank/buyer-invites";
import { DealError, deliveryPreview } from "@/lib/bank/deals";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

/** The invited buyer sees a watermarked, reduced preview of a delivered image before approving. */
export async function GET(req: Request, ctx: RouteContext<"/api/pay/[token]/preview/[dealId]/[index]">) {
  try {
    rateLimit(req, "pay-preview", 120, 60 * 60 * 1000);
    const p = await ctx.params;
    const invite = await buyerInviteForRequest(p.token).catch((e) => {
      throw e instanceof BuyerInviteError ? new HttpError(404, e.message) : e;
    });
    const id = Number(p.dealId);
    const index = Number(p.index);
    if (!Number.isInteger(id) || !Number.isInteger(index)) throw new HttpError(400, "Invalid request");
    const page = Number(new URL(req.url).searchParams.get("page") ?? 1);
    const { jpeg, pages } = await deliveryPreview(getAddress(invite.buyerWallet), id, index, page).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    return new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-preview-pages": String(pages) } });
  } catch (err) {
    return errorResponse(err);
  }
}
