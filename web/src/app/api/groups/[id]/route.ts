import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, deleteGroup, groupDetail } from "@/lib/social";

/** A group wallet: members and roles, invites, stats, payment and rule votes, recent activity. */
export async function GET(_req: Request, ctx: RouteContext<"/api/groups/[id]">) {
  try {
    const { user } = await requireCustomer();
    const g = await groupDetail(user.id, (await ctx.params).id).catch((e) => {
      throw e instanceof SocialError ? new HttpError(404, e.message) : e;
    });
    const { members, proposals, ...rest } = g;
    return Response.json({
      ...rest,
      members: members.map((m) => ({ userId: m.userId, name: m.name, role: m.role, canSign: m.canSign, joinedAt: m.joinedAt })),
      proposals: proposals.map((p) => ({
        id: p.id,
        proposerId: p.proposerId,
        title: p.title,
        milestones: p.milestones,
        status: p.status,
        dealId: p.dealId,
        yes: p.yes,
        no: p.no,
        myVote: p.myVote,
        voters: p.voters,
        proposer: p.proposer,
        mine: p.mine,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The admin deletes the group (open votes end; drafts stay with their proposers). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/groups/[id]">) {
  try {
    const { user } = await requireCustomer();
    await deleteGroup(user.id, (await ctx.params).id).catch((e) => {
      throw e instanceof SocialError ? new HttpError(403, e.message) : e;
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
