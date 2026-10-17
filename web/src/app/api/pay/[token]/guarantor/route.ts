import { getAddress } from "viem";
import { z } from "zod";

import { BuyerInviteError, buyerInviteForRequest } from "@/lib/bank/buyer-invites";
import { DealError } from "@/lib/bank/deals";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";
import { GuarantorInput, saveGuarantor } from "@/lib/guarantors";

/** The invited buyer names their guarantor on a deal (needed before paying when the deal requires one). */
export async function PUT(req: Request, ctx: RouteContext<"/api/pay/[token]/guarantor">) {
  try {
    rateLimit(req, "pay-guarantor", 30, 60 * 60 * 1000);
    const invite = await buyerInviteForRequest((await ctx.params).token).catch((e) => {
      throw e instanceof BuyerInviteError ? new HttpError(404, e.message) : e;
    });
    const body = GuarantorInput.extend({ dealId: z.number().int().min(0) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Give the guarantor's name, a phone or email, and how they relate to you");
    const { dealId, ...g } = body.data;
    await saveGuarantor(`link:${invite.id}`, getAddress(invite.buyerWallet), dealId, g).catch((e) => {
      throw e instanceof DealError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
