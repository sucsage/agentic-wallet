import { DraftError, approveDraft, draftView } from "@/lib/bank/drafts";
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
    const { draft, funding } = await approveDraft(user.id, wallet, id).catch((e) => {
      throw e instanceof DraftError ? new HttpError(400, e.message) : e;
    });
    const body = { draft: await draftView(draft), funding };
    return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
