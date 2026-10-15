import { z } from "zod";

import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, proposeToGroup } from "@/lib/social";

export const maxDuration = 120;

/** Puts one of the member's own deal drafts to the group's vote (their yes counts at once). */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/[id]/proposals">) {
  try {
    const { user } = await requireCustomer();
    const body = z.object({ draftId: z.string().min(1) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Give the draftId of one of your drafts");
    const result = await proposeToGroup(user.id, (await ctx.params).id, body.data.draftId).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
