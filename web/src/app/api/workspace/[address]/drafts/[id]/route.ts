import { discardDraft } from "@/lib/bank/drafts";
import { HttpError, errorResponse, requireUser, userWallet } from "@/lib/guard";

/** Discards a draft the user has not approved: nothing was signed or debited for it. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/workspace/[address]/drafts/[id]">) {
  try {
    const { address, id } = await ctx.params;
    const wallet = await userWallet(address);
    const user = await requireUser();
    if (!(await discardDraft(user.id, wallet, id))) throw new HttpError(404, "No open draft with this id");
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
