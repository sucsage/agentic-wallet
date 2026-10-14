import "server-only";

import { type Address, getAddress } from "viem";

import type { Currency } from "@/generated/prisma/client";

import { agentWalletAbi } from "./abis";
import { approveDraft } from "./bank/drafts";
import { type TxOutcome, publicClient, send } from "./chain";
import { db } from "./db";

/**
 * Friends and groups.
 *
 * Friends are found by their bank username, only within the same bank (same currency): the demo
 * has no FX. Being friends allowlists nobody; making a friend a payee is a separate owner
 * transaction (setRecipient), so a hijacked friendship cannot redirect payments.
 *
 * A group shares decisions, not money: a member's deal draft becomes a group proposal, and once
 * `threshold` members vote yes it is locked from the proposer's own bank account, just in time.
 */

export class SocialError extends Error {}

export type FriendView = {
  friendshipId: string;
  userId: string;
  name: string;
  username: string;
  status: "PENDING" | "ACCEPTED";
  direction: "incoming" | "outgoing" | "mutual";
  wallet: string | null;
  allowlisted: boolean;
};

async function walletOf(userId: string): Promise<Address | null> {
  const link = await db.userWallet.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  return link ? getAddress(link.walletAddress) : null;
}

async function isAllowlisted(wallet: Address | null, recipient: Address | null): Promise<boolean> {
  if (!wallet || !recipient) return false;
  return publicClient().readContract({ address: wallet, abi: agentWalletAbi, functionName: "allowedRecipient", args: [recipient] });
}

export async function listFriends(userId: string): Promise<FriendView[]> {
  const rows = await db.friendship.findMany({
    where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
    include: {
      requester: { select: { id: true, name: true, bankCustomer: { select: { username: true } } } },
      addressee: { select: { id: true, name: true, bankCustomer: { select: { username: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  const mine = await walletOf(userId);
  return Promise.all(
    rows.map(async (f) => {
      const other = f.requesterId === userId ? f.addressee : f.requester;
      const theirWallet = await walletOf(other.id);
      return {
        friendshipId: f.id,
        userId: other.id,
        name: other.name,
        username: other.bankCustomer?.username ?? "",
        status: f.status,
        direction: f.status === "ACCEPTED" ? "mutual" : f.requesterId === userId ? "outgoing" : "incoming",
        wallet: theirWallet,
        allowlisted: f.status === "ACCEPTED" ? await isAllowlisted(mine, theirWallet) : false,
      } satisfies FriendView;
    }),
  );
}

/** Sends a friend request to a customer of the same bank, found by username. */
export async function requestFriend(userId: string, currency: Currency, username: string) {
  const target = await db.bankCustomer.findUnique({ where: { currency_username: { currency, username: username.toLowerCase() } } });
  // Same answer for "no such customer" and "customer without an app account": no user enumeration
  // beyond what the bank's own username lookup already implies.
  if (!target?.userId) throw new SocialError("No app user with that username at your bank");
  if (target.userId === userId) throw new SocialError("You cannot add yourself");
  const existing = await db.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId: target.userId },
        { requesterId: target.userId, addresseeId: userId },
      ],
    },
  });
  if (existing) {
    // They already asked us: asking back means yes.
    if (existing.status === "PENDING" && existing.addresseeId === userId) return acceptFriend(userId, existing.id);
    return existing;
  }
  return db.friendship.create({ data: { requesterId: userId, addresseeId: target.userId } });
}

export async function acceptFriend(userId: string, friendshipId: string) {
  const f = await db.friendship.findFirst({ where: { id: friendshipId, addresseeId: userId, status: "PENDING" } });
  if (!f) throw new SocialError("No pending request to accept");
  return db.friendship.update({ where: { id: f.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
}

/** Declines a request or unfriends. Does not touch any allowlist (remove the payee separately). */
export async function removeFriend(userId: string, friendshipId: string) {
  const f = await db.friendship.findFirst({ where: { id: friendshipId, OR: [{ requesterId: userId }, { addresseeId: userId }] } });
  if (!f) throw new SocialError("Friendship not found");
  await db.friendship.delete({ where: { id: f.id } });
}

async function acceptedFriend(userId: string, friendshipId: string) {
  const f = await db.friendship.findFirst({
    where: { id: friendshipId, status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
  });
  if (!f) throw new SocialError("Not a friend");
  return f.requesterId === userId ? f.addresseeId : f.requesterId;
}

/** Owner action: lets (or stops) the agent pay a friend's wallet. Tier 1: the user's click. */
export async function setFriendPayee(userId: string, friendshipId: string, allowed: boolean): Promise<TxOutcome> {
  const friendId = await acceptedFriend(userId, friendshipId);
  const [mine, theirs] = await Promise.all([walletOf(userId), walletOf(friendId)]);
  if (!mine) throw new SocialError("Create your agent wallet first");
  if (!theirs) throw new SocialError("Your friend has no agent wallet yet");
  return send("owner", { address: mine, abi: agentWalletAbi, functionName: "setRecipient", args: [theirs, allowed] });
}

/** Display names for addresses this user deals with: friends' wallets. */
export async function friendLabels(userId: string): Promise<Map<string, string>> {
  const friends = await listFriends(userId);
  return new Map(friends.filter((f) => f.wallet).map((f) => [f.wallet!.toLowerCase(), f.name]));
}

// ------------------------------------------------------------------------------------------
// Groups
// ------------------------------------------------------------------------------------------

export async function createGroup(userId: string, currency: Currency, input: { name: string; memberIds: string[]; threshold: number }) {
  const friends = new Set((await listFriends(userId)).filter((f) => f.status === "ACCEPTED").map((f) => f.userId));
  const members = [...new Set(input.memberIds)].filter((id) => id !== userId);
  if (members.some((id) => !friends.has(id))) throw new SocialError("Only friends can be added to a group");
  const size = members.length + 1;
  if (input.threshold < 1 || input.threshold > size) throw new SocialError(`Threshold must be between 1 and ${size}`);
  return db.group.create({
    data: {
      name: input.name,
      currency,
      createdById: userId,
      threshold: input.threshold,
      members: {
        create: [{ userId, role: "ADMIN" }, ...members.map((id) => ({ userId: id, role: "MEMBER" as const }))],
      },
    },
  });
}

async function memberGroup(userId: string, groupId: string) {
  const g = await db.group.findFirst({ where: { id: groupId, members: { some: { userId } } } });
  if (!g) throw new SocialError("Group not found");
  return g;
}

export async function listGroups(userId: string) {
  return db.group.findMany({
    where: { members: { some: { userId } } },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      proposals: { where: { status: "OPEN" }, select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function groupDetail(userId: string, groupId: string) {
  await memberGroup(userId, groupId);
  const g = await db.group.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      proposals: { include: { votes: true }, orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  const drafts = await db.dealDraft.findMany({ where: { id: { in: g.proposals.map((p) => p.draftId) } } });
  const byId = new Map(drafts.map((d) => [d.id, d]));
  return {
    ...g,
    proposals: g.proposals.map((p) => {
      const d = byId.get(p.draftId);
      return {
        ...p,
        title: d?.title ?? "",
        milestones: d?.milestones ?? [],
        dealId: d?.dealId ?? null,
        yes: p.votes.filter((v) => v.approve).length,
        no: p.votes.filter((v) => !v.approve).length,
        myVote: p.votes.find((v) => v.userId === userId)?.approve ?? null,
      };
    }),
  };
}

/** A member puts one of their own drafts to the group's vote. Their own yes is counted at once. */
export async function proposeToGroup(userId: string, groupId: string, draftId: string) {
  await memberGroup(userId, groupId);
  const draft = await db.dealDraft.findFirst({ where: { id: draftId, userId, status: "DRAFT" } });
  if (!draft) throw new SocialError("Draft not found or already used");
  const p = await db.groupProposal.create({ data: { groupId, proposerId: userId, draftId } });
  return vote(userId, p.id, true);
}

/**
 * Records a vote. When the yes votes reach the threshold, the proposer's draft is locked from the
 * proposer's bank account; when enough no votes make that impossible, the proposal is rejected.
 */
export async function vote(userId: string, proposalId: string, approve: boolean) {
  const p = await db.groupProposal.findUnique({ where: { id: proposalId }, include: { group: { include: { members: true } } } });
  if (!p || !p.group.members.some((m) => m.userId === userId)) throw new SocialError("Proposal not found");
  if (p.status !== "OPEN") throw new SocialError(`This proposal is already ${p.status.toLowerCase()}`);
  await db.groupVote.upsert({
    where: { proposalId_userId: { proposalId, userId } },
    update: { approve },
    create: { proposalId, userId, approve },
  });
  const votes = await db.groupVote.findMany({ where: { proposalId } });
  const yes = votes.filter((v) => v.approve).length;
  const no = votes.filter((v) => !v.approve).length;
  const size = p.group.members.length;

  if (yes >= p.group.threshold) {
    // Claim the execution first, so two last votes at once cannot both lock the deal.
    const claimed = await db.groupProposal.updateMany({ where: { id: p.id, status: "OPEN" }, data: { status: "EXECUTED" } });
    if (claimed.count === 1) {
      const wallet = await walletOf(p.proposerId);
      if (!wallet) throw new SocialError("The proposer has no agent wallet");
      try {
        const { funding } = await approveDraft(p.proposerId, wallet, p.draftId);
        // PENDING stays EXECUTED: the funding resumes when the proposer retries the draft.
        if (funding.status !== "FUNDED" && funding.status !== "PENDING") {
          await db.groupProposal.update({ where: { id: p.id }, data: { status: "FAILED" } });
        }
        return { status: funding.status === "FUNDED" || funding.status === "PENDING" ? "EXECUTED" : "FAILED", yes, no, funding };
      } catch (err) {
        await db.groupProposal.update({ where: { id: p.id }, data: { status: "FAILED" } });
        throw err;
      }
    }
  } else if (size - no < p.group.threshold) {
    await db.groupProposal.update({ where: { id: p.id }, data: { status: "REJECTED" } });
    return { status: "REJECTED", yes, no };
  }
  return { status: "OPEN", yes, no };
}

/** Open group proposals waiting for this user's vote. */
export async function pendingVotes(userId: string) {
  const open = await db.groupProposal.findMany({
    where: { status: "OPEN", group: { members: { some: { userId } } }, votes: { none: { userId } } },
    include: { group: { select: { id: true, name: true, threshold: true } }, votes: true },
  });
  const drafts = await db.dealDraft.findMany({ where: { id: { in: open.map((p) => p.draftId) } } });
  const byId = new Map(drafts.map((d) => [d.id, d]));
  return open.map((p) => ({
    proposalId: p.id,
    group: p.group,
    title: byId.get(p.draftId)?.title ?? "",
    yes: p.votes.filter((v) => v.approve).length,
  }));
}
