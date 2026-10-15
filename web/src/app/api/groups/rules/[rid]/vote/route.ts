import { z } from "zod";

import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, ruleVote } from "@/lib/social";

export async function POST(req: Request, ctx: RouteContext<"/api/groups/rules/[rid]/vote">) {
  try {
    const { user } = await requireCustomer();
    const body = z.object({ approve: z.boolean() }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { approve }");
    const r = await ruleVote(user.id, (await ctx.params).rid, body.data.approve).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
