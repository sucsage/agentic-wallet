import { z } from "zod";

import { DealError } from "@/lib/bank/deals";
import { startOfferPlan } from "@/lib/bank/plan-actions";
import { PlanError } from "@/lib/bank/payment-plans";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

/** The buyer starts paying a seller's offer in parts (part 1 now). */
export async function POST(req: Request) {
  try {
    rateLimit(req, "plan-start", 20, 60 * 60 * 1000);
    const { user, wallet } = await requireBankWallet();
    const body = z.object({ dealId: z.number().int().min(0) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Which deal?");
    const plan = await startOfferPlan(user.id, wallet, body.data.dealId).catch((e) => {
      throw e instanceof PlanError || e instanceof DealError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ plan: { id: plan.id, status: plan.status, paidParts: plan.paidParts } });
  } catch (err) {
    return errorResponse(err);
  }
}
