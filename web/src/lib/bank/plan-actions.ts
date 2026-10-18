import "server-only";

import { type Address, getAddress } from "viem";

import { db } from "../db";
import { acceptAndPay, dealForWallet, syncDealLater } from "./deals";
import { DraftError, approveDraft } from "./drafts";
import { PlanError, completePlan, payNextPart, planOf, startPlan } from "./payment-plans";

/**
 * What the buttons on a split payment do (lib/bank/payment-plans): pay the next part, and when that
 * was the last one, lock the deal: a purchase is confirmed, a seller's offer accepted.
 */
export async function payPart(userId: string, planId: string) {
  let plan = await payNextPart(userId, planId);
  const draft = await db.dealDraft.findUniqueOrThrow({ where: { id: plan.draftId } });
  if (plan.paidParts >= planOf(draft)!.length) plan = await lockPaidPlan(userId, plan.id);
  return plan;
}

/** Every part is paid: lock it (also the "Lock now" retry when locking failed the first time). */
export async function lockPaidPlan(userId: string, planId: string) {
  const plan = await db.paymentPlan.findUniqueOrThrow({ where: { id: planId }, include: { draft: true } });
  if (plan.payerUserId !== userId) throw new PlanError("Split payment not found");
  const payer = getAddress(plan.payerWallet);
  return completePlan(plan.id, async () => {
    if (plan.draft.side === "BUY") {
      const r = await approveDraft(userId, payer, plan.draft.id, { fromPlan: true }).catch((e) => {
        throw e instanceof DraftError ? new PlanError(e.message) : e;
      });
      return r.funding.status === "FUNDED";
    }
    const r = await acceptAndPay(payer, plan.draft.dealId!, { fromPlan: true });
    syncDealLater(payer, plan.draft.dealId!);
    return r.status === "FUNDED";
  });
}

/** The buyer starts paying a seller's offer in parts, from the deal's page. */
export async function startOfferPlan(userId: string, wallet: Address, dealId: number) {
  const deal = await dealForWallet(wallet, dealId);
  if (deal.role !== "buyer" || deal.status !== "Proposed" || deal.offeredBy !== "them") throw new PlanError("Only an open offer to you can be paid in parts");
  const draft = await db.dealDraft.findFirst({ where: { dealId, walletAddress: getAddress(deal.counterparty), side: "SELL" } });
  if (!draft || !planOf(draft)) throw new PlanError("This offer has no split payment");
  return startPlan(userId, wallet, draft);
}
