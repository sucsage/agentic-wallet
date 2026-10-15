import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, groupDetail } from "@/lib/social";

/** A group with its members and proposals (title, votes, my vote, the deal once locked). */
export async function GET(_req: Request, ctx: RouteContext<"/api/groups/[id]">) {
  try {
    const { user } = await requireCustomer();
    const g = await groupDetail(user.id, (await ctx.params).id).catch((e) => {
      throw e instanceof SocialError ? new HttpError(404, e.message) : e;
    });
    return Response.json({
      id: g.id,
      name: g.name,
      currency: g.currency,
      threshold: g.threshold,
      members: g.members.map((m) => ({ userId: m.user.id, name: m.user.name, role: m.role })),
      proposals: g.proposals.map((p) => ({
        id: p.id,
        proposerId: p.proposerId,
        title: p.title,
        milestones: p.milestones,
        status: p.status,
        dealId: p.dealId,
        yes: p.yes,
        no: p.no,
        myVote: p.myVote,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
