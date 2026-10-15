import { db } from "@/lib/db";
import { HttpError, errorResponse, requireUser, userWallet } from "@/lib/guard";

/** Discards a draft the user has not approved: nothing was signed or debited for it. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/workspace/[address]/drafts/[id]">) {
  try {
    const { address, id } = await ctx.params;
    const wallet = await userWallet(address);
    const user = await requireUser();
    const done = await db.dealDraft.updateMany({
      where: { id, userId: user.id, walletAddress: wallet, status: { in: ["DRAFT", "FAILED"] } },
      data: { status: "CANCELLED" },
    });
    if (done.count !== 1) throw new HttpError(404, "No open draft with this id");
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
