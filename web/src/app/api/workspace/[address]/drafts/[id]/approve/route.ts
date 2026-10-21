import { confirmDraft } from "@/lib/bank/confirm-draft";
import { errorResponse, rateLimit, requireUser, userWallet } from "@/lib/guard";
import { publicOrigin } from "@/lib/origins";

export const maxDuration = 120;

/**
 * The user presses "Approve & lock" on a preview (lib/bank/confirm-draft). Calling it again resumes
 * or reports the same result.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/workspace/[address]/drafts/[id]/approve">) {
  try {
    rateLimit(req, "approve", 20, 60 * 60 * 1000);
    const { address, id } = await ctx.params;
    const wallet = await userWallet(address);
    const user = await requireUser();
    const body = await confirmDraft(user.id, wallet, id, publicOrigin(req));
    return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return errorResponse(err);
  }
}
