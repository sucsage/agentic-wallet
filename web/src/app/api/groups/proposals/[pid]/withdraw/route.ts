import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, withdrawProposal } from "@/lib/social";

/** The proposer takes an open proposal back. */
export async function POST(_req: Request, ctx: RouteContext<"/api/groups/proposals/[pid]/withdraw">) {
  try {
    const { user } = await requireCustomer();
    await withdrawProposal(user.id, (await ctx.params).pid).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
