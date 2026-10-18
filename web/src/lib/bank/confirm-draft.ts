import "server-only";

import type { Address } from "viem";

import { companyOfWallet } from "../company";
import { db } from "../db";
import { HttpError } from "../guard";
import { SocialError, proposeToGroup } from "../social";
import { DraftError, approveDraft, draftView } from "./drafts";
import { inviteLinkFor } from "./invites";
import { PlanError, startPlan } from "./payment-plans";

/**
 * Confirm on a deal preview, from the website (the draft card) or the desktop app (a signed
 * intent). The draft is read from the database, never from the request. As a company or group the
 * click submits it to its signers; a purchase paid in parts pays part 1 into the plan; otherwise it
 * is signed and paid just in time. Calling it again resumes or reports the same result.
 */
export async function confirmDraft(userId: string, wallet: Address, id: string, origin: string) {
  const company = await companyOfWallet(wallet);
  const pending = await db.dealDraft.findFirst({ where: { id, walletAddress: wallet, status: { in: ["PREVIEW", "DRAFT", "FAILED"] } } });
  if (company && pending) {
    const open = await db.groupProposal.findFirst({ where: { draftId: id, status: "OPEN" } });
    const vote = open
      ? { status: "OPEN" }
      : await proposeToGroup(userId, company.groupId, id).catch((e) => {
          throw e instanceof SocialError ? new HttpError(400, e.message) : e;
        });
    const draft = await db.dealDraft.findUniqueOrThrow({ where: { id } });
    return { draft: await draftView(draft), companyVote: { ...vote, threshold: company.group.threshold, company: company.name } };
  }
  // A purchase paid in parts (แบ่งจ่าย): Confirm pays part 1 into the plan; nothing is locked yet.
  if (pending && pending.side === "BUY" && pending.paymentPlan) {
    const plan = await startPlan(userId, wallet, pending).catch((e) => {
      throw e instanceof PlanError ? new HttpError(400, e.message) : e;
    });
    const fresh = await db.dealDraft.update({ where: { id }, data: { status: "DRAFT" } });
    return { draft: await draftView(fresh), plan: { id: plan.id, paidParts: plan.paidParts, status: plan.status } };
  }
  const { draft, funding } = await approveDraft(userId, wallet, id).catch((e) => {
    throw e instanceof DraftError ? new HttpError(400, e.message) : e;
  });
  // Confirming a deal with someone who has no account made their private link: show it now too.
  const other = draft.side === "SELL" ? draft.buyer : draft.seller;
  const invite = draft.inviteId && other ? await inviteLinkFor(userId, other, origin) : null;
  return { draft: await draftView(draft), funding, invite };
}

/** The app's own address (links handed out from server code without a request, e.g. the desktop app's moves). */
export const appOrigin = () =>
  process.env.APP_ORIGIN ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : `http://localhost:${process.env.PORT ?? 3000}`);
