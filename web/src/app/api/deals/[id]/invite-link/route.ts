import { z } from "zod";

import { DealError, dealForWallet } from "@/lib/bank/deals";
import { inviteLinkFor } from "@/lib/bank/invites";
import { RelinkError, relinkInvite } from "@/lib/bank/relink";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

/**
 * A new private link for the other side of this deal (the old one stops working): only with the
 * code they got on their link's page and sent to you (lib/bank/relink).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/invite-link">) {
  try {
    rateLimit(req, "invite-link", 20, 60 * 60 * 1000);
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    const body = z.object({ code: z.string().max(12).optional() }).safeParse(await req.json().catch(() => ({})));
    const origin = new URL(req.url).origin;
    const invite = await inviteLinkFor(user.id, deal.counterparty, origin);
    if (!invite) throw new HttpError(404, "You did not invite the other side of this deal");
    return Response.json(
      await relinkInvite(user.id, invite, body.success ? body.data.code : undefined, origin).catch((e) => {
        throw e instanceof RelinkError ? new HttpError(400, e.message) : e;
      }),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
