import { z } from "zod";

import { DraftError } from "@/lib/bank/drafts";
import { HttpError, errorResponse, rateLimit, requireUser } from "@/lib/guard";
import { PostError, choose } from "@/lib/public-posts";

/** The owner chooses an applicant: the post's deal is drafted with them (a preview to confirm). */
export async function POST(req: Request, ctx: RouteContext<"/api/posts/[id]/choose">) {
  try {
    rateLimit(req, "post-choose", 20, 60 * 60 * 1000);
    const user = await requireUser();
    const body = z.object({ applicationId: z.string().min(5).max(40) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Which application?");
    const r = await choose(user.id, (await ctx.params).id, body.data.applicationId).catch((e) => {
      throw e instanceof PostError || e instanceof DraftError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ draftId: r.draft.id, name: r.name, contact: r.contact });
  } catch (err) {
    return errorResponse(err);
  }
}
