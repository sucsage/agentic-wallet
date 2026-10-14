import { draftView, listDrafts } from "@/lib/bank/drafts";
import { errorResponse, requireUser, userWallet } from "@/lib/guard";

/** The agent's bank-deal drafts for this wallet, newest first (so the chat can show them after a reload). */
export async function GET(_req: Request, ctx: RouteContext<"/api/workspace/[address]/drafts">) {
  try {
    const wallet = await userWallet((await ctx.params).address);
    const user = await requireUser();
    const drafts = await listDrafts(user.id, wallet);
    return Response.json({ drafts: await Promise.all(drafts.map((d) => draftView(d))) });
  } catch (err) {
    return errorResponse(err);
  }
}
