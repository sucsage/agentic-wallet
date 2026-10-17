import { getAddress } from "viem";

import { BuyerInviteError, buyerInviteForRequest } from "@/lib/bank/buyer-invites";
import { asDealFileHttp, fileResponse, readDealFile } from "@/lib/deal-files";
import { HttpError, errorResponse } from "@/lib/guard";

/** A file the seller attached to the deal, for the invited buyer (whoever holds the link). */
export async function GET(_req: Request, ctx: RouteContext<"/api/pay/[token]/deal-files/[dealId]/[fileId]">) {
  try {
    const p = await ctx.params;
    const invite = await buyerInviteForRequest(p.token).catch((e) => {
      throw e instanceof BuyerInviteError ? new HttpError(404, e.message) : e;
    });
    const f = await readDealFile(getAddress(invite.buyerWallet), Number(p.dealId), p.fileId).catch((e) => {
      throw asDealFileHttp(e) ? new HttpError(404, (e as Error).message) : e;
    });
    return fileResponse(f);
  } catch (err) {
    return errorResponse(err);
  }
}
