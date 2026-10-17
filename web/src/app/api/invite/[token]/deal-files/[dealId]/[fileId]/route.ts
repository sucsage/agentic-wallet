import { getSession } from "@/lib/auth";
import { getAddress } from "viem";

import { InviteError, inviteForRequest } from "@/lib/bank/invites";
import { asDealFileHttp, fileResponse, readDealFile } from "@/lib/deal-files";
import { HttpError, errorResponse } from "@/lib/guard";

/** A file the buyer attached to the deal, for the invited seller (whoever holds the link). */
export async function GET(_req: Request, ctx: RouteContext<"/api/invite/[token]/deal-files/[dealId]/[fileId]">) {
  try {
    const p = await ctx.params;
    const invite = await inviteForRequest(p.token, (await getSession())?.user.id ?? null).catch((e) => {
      throw e instanceof InviteError ? new HttpError(404, e.message) : e;
    });
    const f = await readDealFile(getAddress(invite.sellerWallet), Number(p.dealId), p.fileId).catch((e) => {
      throw asDealFileHttp(e) ? new HttpError(404, (e as Error).message) : e;
    });
    return fileResponse(f);
  } catch (err) {
    return errorResponse(err);
  }
}
