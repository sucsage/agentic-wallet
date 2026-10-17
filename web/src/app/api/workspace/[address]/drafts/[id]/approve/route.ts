import { DraftError, approveDraft, draftView } from "@/lib/bank/drafts";
import { PlanError, startPlan } from "@/lib/bank/payment-plans";
import { inviteLinkFor } from "@/lib/bank/invites";
import { companyOfWallet } from "@/lib/company";
import { db } from "@/lib/db";
import { SocialError, proposeToGroup } from "@/lib/social";
import { HttpError, errorResponse, rateLimit, requireUser, userWallet } from "@/lib/guard";

export const maxDuration = 120;

/**
 * The user presses "Approve & lock": the draft (read from the database, not the request) is signed
 * and paid just in time from their bank account. Calling it again resumes or reports the same result.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/workspace/[address]/drafts/[id]/approve">) {
  try {
    rateLimit(req, "approve", 20, 60 * 60 * 1000);
    const { address, id } = await ctx.params;
    const wallet = await userWallet(address);
    const user = await requireUser();
    // As a company or group: the click submits the draft (a purchase or an offer to sell in its
    // name) to its signers (the user's yes counts).
    const company = await companyOfWallet(wallet);
    const pending = await db.dealDraft.findFirst({ where: { id, walletAddress: wallet, status: { in: ["PREVIEW", "DRAFT", "FAILED"] } } });
    if (company && pending) {
      const open = await db.groupProposal.findFirst({ where: { draftId: id, status: "OPEN" } });
      const vote = open
        ? { status: "OPEN" }
        : await proposeToGroup(user.id, company.groupId, id).catch((e) => {
            throw e instanceof SocialError ? new HttpError(400, e.message) : e;
          });
      const draft = await db.dealDraft.findUniqueOrThrow({ where: { id } });
      const body = { draft: await draftView(draft), companyVote: { ...vote, threshold: company.group.threshold, company: company.name } };
      return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { headers: { "content-type": "application/json" } });
    }
    // A purchase paid in parts (แบ่งจ่าย): Confirm pays part 1 into the plan; nothing is locked yet.
    if (pending && pending.side === "BUY" && pending.paymentPlan) {
      const plan = await startPlan(user.id, wallet, pending).catch((e) => {
        throw e instanceof PlanError ? new HttpError(400, e.message) : e;
      });
      const fresh = await db.dealDraft.update({ where: { id }, data: { status: "DRAFT" } });
      const body = { draft: await draftView(fresh), plan: { id: plan.id, paidParts: plan.paidParts, status: plan.status } };
      return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { headers: { "content-type": "application/json" } });
    }
    const { draft, funding } = await approveDraft(user.id, wallet, id).catch((e) => {
      throw e instanceof DraftError ? new HttpError(400, e.message) : e;
    });
    // Confirming a deal with someone who has no account made their private link: show it now too.
    const other = draft.side === "SELL" ? draft.buyer : draft.seller;
    const invite = draft.inviteId && other ? await inviteLinkFor(user.id, other, new URL(req.url).origin) : null;
    const body = { draft: await draftView(draft), funding, invite };
    return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
