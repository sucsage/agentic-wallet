import { getAddress } from "viem";

import { BuyerInviteError, buyerInviteForRequest } from "@/lib/bank/buyer-invites";
import { DealError, deliveryFile } from "@/lib/bank/deals";
import { fileResponse } from "@/lib/deal-files";
import { HttpError, errorResponse } from "@/lib/guard";

/** The invited buyer downloads a delivered file, once the escrow released its key. */
export async function GET(_req: Request, ctx: RouteContext<"/api/pay/[token]/files/[dealId]/[index]">) {
  try {
    const p = await ctx.params;
    const invite = await buyerInviteForRequest(p.token).catch((e) => {
      throw e instanceof BuyerInviteError ? new HttpError(404, e.message) : e;
    });
    const id = Number(p.dealId);
    const index = Number(p.index);
    if (!Number.isInteger(id) || !Number.isInteger(index)) throw new HttpError(400, "Invalid request");
    const f = await deliveryFile(getAddress(invite.buyerWallet), id, index).catch((e) => {
      throw e instanceof DealError ? new HttpError(403, e.message) : e;
    });
    // PDFs and images open in place (preview), anything else downloads; nothing runs.
    const res = fileResponse(f);
    res.headers.set("x-sha256", f.sha256);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
