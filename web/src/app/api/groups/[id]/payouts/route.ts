import { z } from "zod";

import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { SocialError, proposePayout } from "@/lib/social";

const Body = z.object({
  recipients: z.array(z.object({ userId: z.string().min(1).max(40), amount: z.number().positive() })).min(1).max(20),
});

/** A signer proposes paying members from the group's shared account; it happens after the vote. */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/[id]/payouts">) {
  try {
    rateLimit(req, "group-payout", 30, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const body = Body.safeParse(await req.json());
    if (!body.success) throw new HttpError(400, "Choose members and amounts");
    const r = await proposePayout(user.id, (await ctx.params).id, body.data.recipients).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json(r, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
