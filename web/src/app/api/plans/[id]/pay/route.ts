import { DealError } from "@/lib/bank/deals";
import { lockPaidPlan, payPart } from "@/lib/bank/plan-actions";
import { PlanError } from "@/lib/bank/payment-plans";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

export const maxDuration = 120;

/** Pays the next part of a split payment ({ lock: true } retries locking a fully paid one). */
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/pay">) {
  try {
    rateLimit(req, "plan-pay", 30, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const id = (await ctx.params).id;
    const body = (await req.json().catch(() => ({}))) as { lock?: boolean };
    const plan = await (body.lock ? lockPaidPlan(user.id, id) : payPart(user.id, id)).catch((e) => {
      throw e instanceof PlanError || e instanceof DealError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ plan: { id: plan.id, status: plan.status, paidParts: plan.paidParts } });
  } catch (err) {
    return errorResponse(err);
  }
}
