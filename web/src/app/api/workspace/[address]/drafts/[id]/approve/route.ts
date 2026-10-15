import { DraftError, approveDraft, draftView } from "@/lib/bank/drafts";
import { HttpError, errorResponse, rateLimit, requireUser, userWallet } from "@/lib/guard";

export const maxDuration = 120;

/**
 * The user presses "Approve & lock": the draft (read from the database, not the request) is signed
 * and paid just in time from their bank account. Calling it again resumes or reports the same result.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/workspace/[address]/drafts/[id]/approve">) {
  try {
    rateLimit(req, "approve", 20, 60 * 60 * 1000);
    const { address, id } = await ctx.params;
    const wallet = await userWallet(address);
    const user = await requireUser();
    const { draft, funding } = await approveDraft(user.id, wallet, id).catch((e) => {
      throw e instanceof DraftError ? new HttpError(400, e.message) : e;
    });
    const body = { draft: await draftView(draft), funding };
    return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
