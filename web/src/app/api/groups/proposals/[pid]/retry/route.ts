import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { SocialError, retryProposal } from "@/lib/social";

export const maxDuration = 120;

/** A signer executes again a payment the group approved but that did not lock. */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/proposals/[pid]/retry">) {
  try {
    rateLimit(req, "group-retry", 20, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const r = await retryProposal(user.id, (await ctx.params).pid).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return new Response(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return errorResponse(err);
  }
}
