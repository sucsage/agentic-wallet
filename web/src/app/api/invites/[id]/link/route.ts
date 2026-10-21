import { InviteError, rotateInviteLink } from "@/lib/bank/invites";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";
import { publicOrigin } from "@/lib/origins";

/** A new link for an invited seller; the previous link stops working. */
export async function POST(req: Request, ctx: RouteContext<"/api/invites/[id]/link">) {
  try {
    rateLimit(req, "invite-link", 20, 60 * 60 * 1000);
    const { user } = await requireBankWallet();
    const token = await rotateInviteLink(user.id, (await ctx.params).id).catch((e) => {
      throw e instanceof InviteError ? new HttpError(404, e.message) : e;
    });
    return Response.json({ link: `${publicOrigin(req)}/invite/${token}` });
  } catch (err) {
    return errorResponse(err);
  }
}
