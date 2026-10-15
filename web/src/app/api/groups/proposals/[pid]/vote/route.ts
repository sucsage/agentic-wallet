import { z } from "zod";

import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { SocialError, vote } from "@/lib/social";

export const maxDuration = 120;

/** A member's yes / no. The vote that reaches the threshold locks the deal from the proposer's bank. */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/proposals/[pid]/vote">) {
  try {
    rateLimit(req, "vote", 60, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const body = z.object({ approve: z.boolean() }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { approve: true | false }");
    const result = await vote(user.id, (await ctx.params).pid, body.data.approve).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return new Response(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
