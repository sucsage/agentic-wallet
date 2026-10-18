import { rotateBuyerInviteLink } from "@/lib/bank/buyer-invites";
import { DealError, dealForWallet } from "@/lib/bank/deals";
import { inviteLinkFor, rotateInviteLink } from "@/lib/bank/invites";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

/** A new private link for the other side of this deal (the old one stops working). */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/invite-link">) {
  try {
    rateLimit(req, "invite-link", 20, 60 * 60 * 1000);
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    const origin = new URL(req.url).origin;
    const invite = await inviteLinkFor(user.id, deal.counterparty, origin);
    if (!invite) throw new HttpError(404, "You did not invite the other side of this deal");
    const token = invite.kind === "seller" ? await rotateInviteLink(user.id, invite.id) : await rotateBuyerInviteLink(user.id, invite.id);
    return Response.json({ link: `${origin}/${invite.kind === "seller" ? "invite" : "pay"}/${token}` });
  } catch (err) {
    return errorResponse(err);
  }
}
