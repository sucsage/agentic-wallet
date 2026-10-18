import { PlanError, cancelPlan } from "@/lib/bank/payment-plans";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

/** The buyer stops a split payment: everything paid so far comes back to their balance. */
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/cancel">) {
  try {
    rateLimit(req, "plan-cancel", 20, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const plan = await cancelPlan(user.id, (await ctx.params).id).catch((e) => {
      throw e instanceof PlanError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ plan: { id: plan.id, status: plan.status, paidParts: plan.paidParts } });
  } catch (err) {
    return errorResponse(err);
  }
}
