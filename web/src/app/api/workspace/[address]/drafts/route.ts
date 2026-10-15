import { draftView, listDrafts } from "@/lib/bank/drafts";
import { errorResponse, requireUser, userWallet } from "@/lib/guard";
import { friendLabels } from "@/lib/social";

/** The agent's bank-deal drafts for this wallet, newest first (so the chat can show them after a reload). */
export async function GET(_req: Request, ctx: RouteContext<"/api/workspace/[address]/drafts">) {
  try {
    const wallet = await userWallet((await ctx.params).address);
    const user = await requireUser();
    const drafts = await listDrafts(user.id, wallet);
    const friends = await friendLabels(user.id);
    return Response.json({ drafts: await Promise.all(drafts.map((d) => draftView(d, friends.get((d.side === "SELL" ? (d.buyer ?? "") : d.seller).toLowerCase())))) });
  } catch (err) {
    return errorResponse(err);
  }
}
