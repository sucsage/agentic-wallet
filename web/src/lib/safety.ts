import "server-only";

import type { ReportReason } from "@/generated/prisma/client";

import { agentWalletAbi } from "./abis";
import { publicClient, send } from "./chain";
import { db } from "./db";
import { primaryWalletAddress } from "./user-wallets";

/**
 * Blocking and reporting other users (from Contacts).
 *
 * A block works both ways: neither side can send a contact request, find the other in search,
 * send money, or be invited to a group by the other. Blocking removes the contact, pending group
 * invites between the two, and (on-chain, best effort) the blocked person from the blocker's
 * allow transfer list, so the agent can no longer pay them. A report goes to the admins; it can
 * block at the same time.
 */

export class SafetyError extends Error {}

/** True when either user blocked the other. */
export async function blockedBetween(a: string, b: string): Promise<boolean> {
  const n = await db.userBlock.count({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
  });
  return n > 0;
}

/** Everyone this user blocked or was blocked by: hidden from search and refused as a counterparty. */
export async function blockedIds(userId: string): Promise<Set<string>> {
  const rows = await db.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

export async function blockUser(userId: string, targetId: string) {
  if (targetId === userId) throw new SafetyError("You cannot block yourself");
  const target = await db.user.findUnique({ where: { id: targetId }, select: { id: true, name: true } });
  if (!target) throw new SafetyError("User not found");
  await db.$transaction([
    db.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
      update: {},
      create: { blockerId: userId, blockedId: targetId },
    }),
    db.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: userId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: userId },
        ],
      },
    }),
    // Group invites either of them sent the other.
    db.groupInvite.deleteMany({
      where: {
        OR: [
          { invitedById: userId, userId: targetId },
          { invitedById: targetId, userId },
        ],
      },
    }),
  ]);
  // Off the allow transfer list of the blocker's own wallet, if they were on it.
  let removedFromList = false;
  try {
    const [mine, theirs] = await Promise.all([primaryWalletAddress(userId), primaryWalletAddress(targetId)]);
    if (mine && theirs) {
      const allowed = await publicClient().readContract({ address: mine, abi: agentWalletAbi, functionName: "allowedRecipient", args: [theirs] });
      if (allowed) {
        const out = await send("owner", { address: mine, abi: agentWalletAbi, functionName: "setRecipient", args: [theirs, false] });
        removedFromList = out.status === "success";
      }
    }
  } catch (e) {
    console.error("block: allow transfer list", e);
  }
  return { name: target.name, removedFromList };
}

export async function unblockUser(userId: string, targetId: string) {
  await db.userBlock.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
}

export async function listBlocked(userId: string) {
  const rows = await db.userBlock.findMany({
    where: { blockerId: userId },
    include: { blocked: { select: { id: true, name: true, bankCustomer: { select: { username: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ userId: r.blocked.id, name: r.blocked.name, username: r.blocked.bankCustomer?.username ?? "", since: r.createdAt.toISOString() }));
}

export const REPORT_REASONS = ["SCAM", "SPAM", "HARASSMENT", "IMPERSONATION", "NOT_DELIVERED", "OTHER"] as const satisfies readonly ReportReason[];

/** Only people the reporter has met in the app: a contact (any state) or a block they made. */
async function knows(userId: string, targetId: string) {
  const [f, b] = await Promise.all([
    db.friendship.count({
      where: {
        OR: [
          { requesterId: userId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: userId },
        ],
      },
    }),
    db.userBlock.count({ where: { blockerId: userId, blockedId: targetId } }),
  ]);
  return f + b > 0;
}

export async function reportUser(userId: string, targetId: string, reason: ReportReason, details: string, alsoBlock: boolean) {
  if (targetId === userId) throw new SafetyError("You cannot report yourself");
  if (!(await knows(userId, targetId))) throw new SafetyError("You can report only your contacts or people you blocked");
  // One open report per pair per day is enough for the reviewers.
  const recent = await db.userReport.findFirst({ where: { reporterId: userId, reportedId: targetId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
  const report = recent
    ? await db.userReport.update({ where: { id: recent.id }, data: { reason, details: details.slice(0, 2000) } })
    : await db.userReport.create({ data: { reporterId: userId, reportedId: targetId, reason, details: details.slice(0, 2000) } });
  const blocked = alsoBlock ? await blockUser(userId, targetId) : null;
  return { id: report.id, blocked: Boolean(blocked) };
}

/** For admins: open reports, newest first, with how many reports each reported user has. */
export async function openReports() {
  const rows = await db.userReport.findMany({
    where: { status: "OPEN" },
    include: { reporter: { select: { name: true } }, reported: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const counts = await db.userReport.groupBy({ by: ["reportedId"], _count: true, where: { reportedId: { in: rows.map((r) => r.reportedId) } } });
  const total = new Map(counts.map((c) => [c.reportedId, c._count]));
  return rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    details: r.details,
    createdAt: r.createdAt.toISOString(),
    reporter: r.reporter.name,
    reported: { id: r.reported.id, name: r.reported.name, reports: total.get(r.reported.id) ?? 1 },
  }));
}

export async function closeReport(id: string) {
  await db.userReport.update({ where: { id }, data: { status: "CLOSED" } });
}
