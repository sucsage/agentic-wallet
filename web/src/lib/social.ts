import "server-only";

import { type Address, getAddress } from "viem";

import { Prisma, type Currency } from "@/generated/prisma/client";

import { agentWalletAbi } from "./abis";
import { type DraftMilestone, approveDraft } from "./bank/drafts";
import { buyerInviteLabels } from "./bank/buyer-invites";
import { inviteLabels } from "./bank/invites";
import { type Recipient, SendError, cleanRecipients, payMany } from "./bank/send";
import { type TxOutcome, publicClient, send } from "./chain";
import { db } from "./db";
import { KycRequired, requireKycFor } from "./kyc";
import { primaryWalletAddress } from "./user-wallets";

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

/** A user's primary wallet: the one their bank account pays for (see user-wallets.ts). */
function walletOf(userId: string): Promise<Address | null> {
  return primaryWalletAddress(userId);
}

async function isAllowlisted(wallet: Address | null, recipient: Address | null): Promise<boolean> {
  if (!wallet || !recipient) return false;
  return publicClient().readContract({ address: wallet, abi: agentWalletAbi, functionName: "allowedRecipient", args: [recipient] });
}

export async function listFriends(userId: string, onWallet?: Address): Promise<FriendView[]> {
  const rows = await db.friendship.findMany({
    where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
    include: {
      requester: { select: { id: true, name: true, bankCustomer: { select: { username: true } } } },
      addressee: { select: { id: true, name: true, bankCustomer: { select: { username: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  const mine = onWallet ?? (await walletOf(userId));
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
export async function setFriendPayee(userId: string, friendshipId: string, allowed: boolean, onWallet?: Address): Promise<TxOutcome> {
  const friendId = await acceptedFriend(userId, friendshipId);
  // onWallet: the wallet the user acts as (a company's); else their own.
  const [mine, theirs] = await Promise.all([onWallet ? Promise.resolve(onWallet) : walletOf(userId), walletOf(friendId)]);
  if (!mine) throw new SocialError("Create your agent wallet first");
  if (!theirs) throw new SocialError("Your friend has no agent wallet yet");
  return send("owner", { address: mine, abi: agentWalletAbi, functionName: "setRecipient", args: [theirs, allowed] });
}

/** Display names for addresses this user deals with: friends' wallets and sellers they invited. */
export async function friendLabels(userId: string): Promise<Map<string, string>> {
  const [friends, invited, buyers] = await Promise.all([listFriends(userId), inviteLabels(userId), buyerInviteLabels(userId)]);
  return new Map([...invited, ...buyers, ...friends.filter((f) => f.wallet).map((f) => [f.wallet!.toLowerCase(), f.name] as const)]);
}

// ------------------------------------------------------------------------------------------
// Groups
// ------------------------------------------------------------------------------------------

export type GroupInviteInput = { userId: string; canSign: boolean };

/**
 * Creates a group with its creator as admin and signer. Everyone else is invited: they become
 * members only by accepting (myGroupInvites / answerGroupInvite). `threshold` is how many signers
 * must approve a payment or a rule change; it must be reachable once the invited signers join.
 */
export async function createGroup(
  userId: string,
  currency: Currency,
  input: { name: string; memberIds?: string[]; members?: GroupInviteInput[]; threshold: number },
  tx: Prisma.TransactionClient = db,
) {
  const name = input.name.trim().slice(0, 60);
  if (name.length < 2) throw new SocialError("Give the group a name");
  const invited = dedupe([...(input.members ?? []), ...(input.memberIds ?? []).map((id) => ({ userId: id, canSign: true }))]).filter((m) => m.userId !== userId);
  if (invited.length === 0) throw new SocialError("Invite at least one contact: a group decides together");
  const friends = new Set((await listFriends(userId)).filter((f) => f.status === "ACCEPTED").map((f) => f.userId));
  if (invited.some((m) => !friends.has(m.userId))) throw new SocialError("Only contacts can be invited to a group");
  await sameCurrency(invited.map((m) => m.userId), currency);
  const signers = 1 + invited.filter((m) => m.canSign).length;
  // At least two votes: the proposer's own yes alone must never lock a group deal.
  if (input.threshold < 2 || input.threshold > signers) throw new SocialError(`Votes needed must be between 2 and the ${signers} signers`);
  return tx.group.create({
    data: {
      name,
      currency,
      createdById: userId,
      threshold: input.threshold,
      members: { create: [{ userId, role: "ADMIN", canSign: true }] },
      invites: { create: invited.map((m) => ({ userId: m.userId, canSign: m.canSign, invitedById: userId })) },
    },
  });
}

function dedupe(list: GroupInviteInput[]) {
  const by = new Map<string, GroupInviteInput>();
  for (const m of list) by.set(m.userId, { userId: m.userId, canSign: (by.get(m.userId)?.canSign ?? false) || m.canSign });
  return [...by.values()];
}

/** Group deals are paid in one currency: everyone in the group must hold a wallet in it. */
async function sameCurrency(userIds: string[], currency: Currency) {
  const banks = await db.bankCustomer.findMany({ where: { userId: { in: userIds } }, select: { userId: true, currency: true } });
  const other = userIds.filter((id) => banks.find((b) => b.userId === id)?.currency !== currency);
  if (other.length) throw new SocialError(`Every member must hold a ${currency} wallet; ${other.length} of the people you chose do not`);
}

/** Invites more contacts to a group the user belongs to (admins invite signers; anyone invites members). */
export async function inviteToGroup(userId: string, groupId: string, members: GroupInviteInput[]) {
  const g = await memberGroup(userId, groupId);
  const me = await db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (members.some((m) => m.canSign) && me?.role !== "ADMIN") throw new SocialError("Only an admin invites signers; propose a rule change instead");
  const friends = new Set((await listFriends(userId)).filter((f) => f.status === "ACCEPTED").map((f) => f.userId));
  if (members.some((m) => !friends.has(m.userId))) throw new SocialError("Only contacts can be invited");
  await sameCurrency(members.map((m) => m.userId), g.currency);
  const existing = new Set((await db.groupMember.findMany({ where: { groupId }, select: { userId: true } })).map((m) => m.userId));
  for (const m of members.filter((x) => !existing.has(x.userId))) {
    await db.groupInvite.upsert({
      where: { groupId_userId: { groupId, userId: m.userId } },
      update: { canSign: m.canSign },
      create: { groupId, userId: m.userId, canSign: m.canSign, invitedById: userId },
    });
  }
}

/** Groups that invited this user and wait for an answer. */
export async function myGroupInvites(userId: string) {
  const rows = await db.groupInvite.findMany({
    where: { userId },
    include: { group: { include: { members: { select: { userId: true } }, company: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  const inviters = await db.user.findMany({ where: { id: { in: rows.map((r) => r.invitedById) } }, select: { id: true, name: true } });
  return rows.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    name: r.group.name,
    company: r.group.company?.name ?? null,
    members: r.group.members.length,
    threshold: r.group.threshold,
    canSign: r.canSign,
    invitedBy: inviters.find((u) => u.id === r.invitedById)?.name ?? "a member",
    createdAt: r.createdAt,
  }));
}

/** Accepts (joins with the role offered) or declines a group invitation. */
export async function answerGroupInvite(userId: string, inviteId: string, accept: boolean) {
  const inv = await db.groupInvite.findFirst({ where: { id: inviteId, userId }, include: { group: { include: { company: true } } } });
  if (!inv) throw new SocialError("Invitation not found");
  await db.groupInvite.delete({ where: { id: inv.id } });
  if (!accept) return { joined: false };
  await sameCurrency([userId], inv.group.currency);
  await joinGroup(userId, inv.group.id, inv.canSign);
  return { joined: true };
}

async function joinGroup(userId: string, groupId: string, canSign: boolean) {
  await db.groupMember.upsert({
    where: { groupId_userId: { groupId, userId } },
    update: {},
    create: { groupId, userId, canSign, role: "MEMBER" },
  });
  // A company's members reach its wallet: drafts, deals and votes as the company.
  const company = await db.company.findUnique({ where: { groupId } });
  if (company) {
    await db.userWallet.upsert({
      where: { userId_walletAddress: { userId, walletAddress: company.walletAddress } },
      update: {},
      create: { userId, walletAddress: company.walletAddress, role: canSign ? "APPROVER" : "VIEWER", label: company.name },
    });
  }
}

const LINK_DAYS = 7;

/** A join link (shown as a QR) for the group. Whoever opens it joins as a member, not a signer. */
export async function groupLink(userId: string, groupId: string) {
  await memberGroup(userId, groupId);
  const { randomBytes } = await import("node:crypto");
  const token = randomBytes(18).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000);
  await db.groupLink.create({ data: { token, groupId, createdById: userId, expiresAt } });
  return { token, expiresAt };
}

/** What a join link shows before joining: the group, who shared it, until when. */
export async function groupLinkInfo(token: string) {
  const link = await db.groupLink.findUnique({ where: { token }, include: { group: { include: { members: true, company: true } } } });
  if (!link || link.expiresAt < new Date()) throw new SocialError("This invitation link is invalid or has expired");
  const by = await db.user.findUnique({ where: { id: link.createdById }, select: { name: true } });
  return { link, view: { name: link.group.name, company: link.group.company?.name ?? null, members: link.group.members.length, currency: link.group.currency, sharedBy: by?.name ?? "a member", expiresAt: link.expiresAt } };
}

export async function joinByLink(userId: string, token: string) {
  const { link } = await groupLinkInfo(token);
  await sameCurrency([userId], link.group.currency);
  await joinGroup(userId, link.groupId, false);
  await db.groupInvite.deleteMany({ where: { groupId: link.groupId, userId } });
  return { groupId: link.groupId };
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
      invites: { select: { id: true } },
      company: { select: { id: true, kind: true, name: true, walletAddress: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

const draftIdsOf = (ps: { draftId: string | null }[]) => ps.map((p) => p.draftId).filter((x): x is string => !!x);

/** A payout proposal's recipients, in minor units. */
function payoutOf(p: { payout: unknown }): { userId: string; amount: string }[] {
  return Array.isArray(p.payout) ? (p.payout as { userId: string; amount: string }[]) : [];
}

type DealAction = { dealId: number; index: number; action: "approve" | "accept" };
const dealActionOf = (p: { dealAction?: unknown }): DealAction | null => (p.dealAction && typeof p.dealAction === "object" ? (p.dealAction as DealAction) : null);

function proposalTitle(p: { payout: unknown; dealAction?: unknown }, draftTitle: string | undefined, nameOf: (id: string | null) => string): string {
  const a = dealActionOf(p);
  if (a) return a.action === "accept" ? `Accept and pay the offer D-${a.dealId}` : `Approve the delivery of D-${a.dealId}, milestone ${a.index + 1} (pays the seller)`;
  const out = payoutOf(p);
  if (!out.length) return draftTitle ?? "a deal";
  const total = out.reduce((t, r) => t + Number(r.amount), 0) / 100;
  return `Pay out ${total.toLocaleString("en-US", { maximumFractionDigits: 2 })} to ${out.map((r) => nameOf(r.userId)).join(", ")}`;
}

/** Totals of the group's executed deals: what was paid through it and what is still locked. */
async function groupMoney(draftIds: string[]) {
  const drafts = await db.dealDraft.findMany({ where: { id: { in: draftIds }, dealId: { not: null } } });
  const total = (d: (typeof drafts)[number]) => (d.milestones as DraftMilestone[]).reduce((t, m) => t + Number(m.amount), 0);
  return { committed: drafts.reduce((t, d) => t + total(d), 0), deals: drafts.length };
}

export async function groupDetail(userId: string, groupId: string) {
  await memberGroup(userId, groupId);
  const g = await db.group.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      proposals: { include: { votes: true }, orderBy: { createdAt: "desc" }, take: 50 },
      invites: { include: { user: { select: { id: true, name: true } } } },
      rules: { include: { votes: true }, orderBy: { createdAt: "desc" }, take: 30 },
      company: true,
    },
  });
  const drafts = await db.dealDraft.findMany({ where: { id: { in: draftIdsOf(g.proposals) } } });
  const byId = new Map(drafts.map((d) => [d.id, d]));
  const nameOf = (id: string | null) => (id ? (g.members.find((m) => m.userId === id)?.user.name ?? g.invites.find((i) => i.userId === id)?.user.name ?? "a former member") : "");
  const signers = g.members.filter((m) => m.canSign);
  const money = await groupMoney(draftIdsOf(g.proposals.filter((p) => p.status === "EXECUTED")));
  const companyAccount = g.company ? await db.bankAccount.findUnique({ where: { ownerAddress: g.company.walletAddress.toLowerCase() } }) : null;
  const me = g.members.find((m) => m.userId === userId);

  // Recent activity: payments proposed / executed, rule changes, people joining.
  const activity = [
    ...g.proposals.map((p) => {
      const d = byId.get(p.draftId ?? "");
      const verb = p.status === "EXECUTED" ? (d?.side === "SELL" ? "Offered" : "Paid") : p.status === "REJECTED" ? "Rejected" : p.status === "FAILED" ? "Failed" : "Proposed";
      return { at: p.createdAt, text: `${verb} · ${proposalTitle(p, d?.title, nameOf)}${p.status === "OPEN" ? ` by ${nameOf(p.proposerId)}` : ""}` };
    }),
    ...g.rules.map((r) => ({ at: r.decidedAt ?? r.createdAt, text: `${r.status === "EXECUTED" ? "Rule changed" : r.status === "REJECTED" ? "Rule change rejected" : "Rule change proposed"} · ${ruleText(r, nameOf)}` })),
    ...g.members.map((m) => ({ at: m.joinedAt, text: `${m.user.name} joined` })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 12);

  return {
    id: g.id,
    name: g.name,
    currency: g.currency,
    threshold: g.threshold,
    createdAt: g.createdAt,
    myRole: me?.role ?? "MEMBER",
    iSign: Boolean(me?.canSign),
    signers: signers.length,
    company: g.company ? { id: g.company.id, kind: g.company.kind, name: g.company.name, maskedTaxId: g.company.maskedTaxId, wallet: g.company.walletAddress, accountNo: companyAccount?.accountNo ?? null, balance: companyAccount?.balance.toString() ?? "0" } : null,
    stats: { committed: money.committed, deals: money.deals, openVotes: g.proposals.filter((p) => p.status === "OPEN").length },
    members: g.members.map((m) => ({ userId: m.userId, name: m.user.name, role: m.role, canSign: m.canSign, joinedAt: m.joinedAt, user: m.user })),
    invites: g.invites.map((i) => ({ id: i.id, userId: i.userId, name: i.user.name, canSign: i.canSign })),
    proposals: g.proposals.map((p) => {
      const d = byId.get(p.draftId ?? "");
      return {
        ...p,
        side: p.payout ? ("PAYOUT" as const) : p.dealAction ? ("RELEASE" as const) : (d?.side ?? "BUY"),
        payout: payoutOf(p).map((r) => ({ name: nameOf(r.userId), amount: Number(r.amount) / 100 })),
        title: proposalTitle(p, d?.title, nameOf),
        milestones: d?.milestones ?? [],
        dealId: d?.dealId ?? null,
        yes: p.votes.filter((v) => v.approve).length,
        no: p.votes.filter((v) => !v.approve).length,
        myVote: p.votes.find((v) => v.userId === userId)?.approve ?? null,
        voters: p.votes.map((v) => ({ name: nameOf(v.userId), approve: v.approve })),
        proposer: nameOf(p.proposerId),
        mine: p.proposerId === userId,
      };
    }),
    rules: g.rules.map((r) => ({
      id: r.id,
      kind: r.kind,
      text: ruleText(r, nameOf),
      status: r.status,
      proposer: nameOf(r.proposerId),
      yes: r.votes.filter((v) => v.approve).length,
      no: r.votes.filter((v) => !v.approve).length,
      myVote: r.votes.find((v) => v.userId === userId)?.approve ?? null,
      createdAt: r.createdAt,
    })),
    activity,
  };
}

function ruleText(r: { kind: string; targetUserId: string | null; threshold: number | null }, nameOf: (id: string | null) => string) {
  if (r.kind === "ADD_SIGNER") return `Make ${nameOf(r.targetUserId)} a signer`;
  if (r.kind === "REMOVE_SIGNER") return `${nameOf(r.targetUserId)} stops signing`;
  if (r.kind === "REMOVE_MEMBER") return `Remove ${nameOf(r.targetUserId)} from the group`;
  return `Votes needed → ${r.threshold}`;
}

/** A member puts one of their own drafts to the group's vote. A signer's own yes is counted at once. */
export async function proposeToGroup(userId: string, groupId: string, draftId: string) {
  const group = await memberGroup(userId, groupId);
  const draft = await db.dealDraft.findFirst({ where: { id: draftId, userId, status: { in: ["DRAFT", "PREVIEW"] } } });
  if (!draft) throw new SocialError("Draft not found or already used");
  const company = await db.company.findUnique({ where: { groupId } });
  if (company && getAddress(draft.walletAddress) !== getAddress(company.walletAddress)) {
    throw new SocialError(`Draft it as ${company.name} (Acting as) so it is paid from the ${company.kind === "GROUP" ? "group" : "company"} account`);
  }
  // A sale is voted on only when it is made in the group's own name (its shared wallet); a member's
  // personal sale locks nothing and needs no vote.
  if (draft.side !== "BUY" && !company) throw new SocialError("Only a purchase can be put to this group's vote: open a group wallet to sell in the group's name");
  const customer = await db.bankCustomer.findFirst({ where: { userId }, select: { currency: true } });
  if (customer?.currency !== group.currency) throw new SocialError(`This group pays in ${group.currency}`);
  // Checked now, so a passing vote does not fail on the proposer's missing KYC.
  const total = (draft.milestones as DraftMilestone[]).reduce((t, m) => t + Number(m.amount), 0);
  if (draft.side === "BUY") {
    await requireKycFor(userId, group.currency, total).catch((e) => {
      throw e instanceof KycRequired ? new SocialError(e.message) : e;
    });
  }
  // Putting an AI preview to the vote is the user confirming it: from now on it is a real draft.
  if (draft.status === "PREVIEW") await db.dealDraft.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
  // A draft whose earlier vote was rejected or withdrawn may be put to a vote again.
  await db.groupProposal.deleteMany({ where: { draftId, status: { in: ["REJECTED", "FAILED"] } } });
  try {
    const p = await db.groupProposal.create({ data: { groupId, proposerId: userId, draftId } });
    const me = await db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (me?.canSign) return await vote(userId, p.id, true);
    return { status: "OPEN", yes: 0, no: 0 };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new SocialError("This draft is already up for a vote");
    throw err;
  }
}

/** The proposer takes a proposal back while it is open; the draft is theirs to approve or discard again. */
export async function withdrawProposal(userId: string, proposalId: string) {
  const done = await db.groupProposal.updateMany({ where: { id: proposalId, proposerId: userId, status: "OPEN" }, data: { status: "REJECTED" } });
  if (done.count !== 1) throw new SocialError("Only the proposer can withdraw an open proposal");
}

/** A member leaves; the group must still be able to reach its vote threshold without them. */
export async function leaveGroup(userId: string, groupId: string) {
  const g = await db.group.findFirst({ where: { id: groupId, members: { some: { userId } } }, include: { members: true, company: true } });
  if (!g) throw new SocialError("Group not found");
  const me = g.members.find((m) => m.userId === userId)!;
  const signersAfter = g.members.filter((m) => m.canSign && m.userId !== userId).length;
  if (me.canSign && signersAfter < g.threshold) {
    throw new SocialError(`The group needs ${g.threshold} signers and would have ${signersAfter}. Change the rule first, or ask the admin to delete it.`);
  }
  if (me.role === "ADMIN" && !g.members.some((m) => m.userId !== userId && m.role === "ADMIN")) {
    if (g.members.length === 1) throw new SocialError("You are the only member: delete the group instead");
    // Hand the admin role to the longest-standing other signer (or member).
    const next = g.members.filter((m) => m.userId !== userId).sort((a, b) => Number(b.canSign) - Number(a.canSign) || a.joinedAt.getTime() - b.joinedAt.getTime())[0];
    await db.groupMember.update({ where: { groupId_userId: { groupId, userId: next.userId } }, data: { role: "ADMIN" } });
  }
  await removeMember(groupId, userId, g.company?.walletAddress ?? null);
}

async function removeMember(groupId: string, userId: string, companyWallet: string | null) {
  await db.groupVote.deleteMany({ where: { userId, proposal: { groupId, status: "OPEN" } } });
  await db.groupRuleVote.deleteMany({ where: { userId, proposal: { groupId, status: "OPEN" } } });
  await db.groupMember.delete({ where: { groupId_userId: { groupId, userId } } });
  if (companyWallet) await db.userWallet.deleteMany({ where: { userId, walletAddress: companyWallet } });
}

/** The admin deletes the group; open votes end and their drafts go back to their proposers. */
export async function deleteGroup(userId: string, groupId: string) {
  const m = await db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (m?.role !== "ADMIN") throw new SocialError("Only the group's owner can dissolve it");
  const company = await db.company.findUnique({ where: { groupId } });
  if (company?.kind === "COMPANY") throw new SocialError("A company's signers group cannot be dissolved while the company has an account");
  if (company) {
    // A group wallet is dissolved only when empty: nobody's money may be left behind.
    const account = await db.bankAccount.findUnique({ where: { ownerAddress: company.walletAddress.toLowerCase() } });
    if (account && account.balance > 0n) throw new SocialError("The group wallet still holds money: pay it out to members first (Pay out to members)");
    await db.userWallet.deleteMany({ where: { walletAddress: company.walletAddress } });
  }
  await db.group.delete({ where: { id: groupId } });
}

/**
 * The owner manages the group directly (no vote): make a member a signer or stop them signing, or
 * remove them. The owner's own place cannot be changed this way, and the group must keep enough
 * signers for its votes-needed rule.
 */
export async function ownerSetMember(ownerId: string, groupId: string, targetUserId: string, change: { canSign: boolean } | { remove: true }) {
  const g = await db.group.findFirst({ where: { id: groupId, members: { some: { userId: ownerId, role: "ADMIN" } } }, include: { members: true, company: true } });
  if (!g) throw new SocialError("Only the group's owner can change members");
  const t = g.members.find((m) => m.userId === targetUserId);
  if (!t) throw new SocialError("Not a member of this group");
  if (t.role === "ADMIN") throw new SocialError("The owner's own place cannot be changed here");
  const signers = g.members.filter((m) => m.canSign).length;
  const losesSigner = t.canSign && ("remove" in change || !change.canSign);
  if (losesSigner && signers - 1 < g.threshold) {
    throw new SocialError(`The group needs ${g.threshold} signers to approve and would have ${signers - 1}: lower the votes needed first`);
  }
  if ("remove" in change) return removeMember(groupId, targetUserId, g.company?.walletAddress ?? null);
  await db.groupMember.update({ where: { groupId_userId: { groupId, userId: targetUserId } }, data: { canSign: change.canSign } });
  if (g.company) {
    await db.userWallet.updateMany({ where: { userId: targetUserId, walletAddress: g.company.walletAddress }, data: { role: change.canSign ? "APPROVER" : "VIEWER" } });
  }
}

/**
 * Records a signer's vote. When the yes votes reach the threshold, the draft is locked from the
 * wallet it was drafted for (the proposer's own, or the company's); when enough no votes make that
 * impossible, the proposal is rejected.
 */
export async function vote(userId: string, proposalId: string, approve: boolean) {
  const p = await db.groupProposal.findUnique({ where: { id: proposalId }, include: { group: { include: { members: true } } } });
  const me = p?.group.members.find((m) => m.userId === userId);
  if (!p || !me) throw new SocialError("Proposal not found");
  if (!me.canSign) throw new SocialError("Only the group's signers vote on payments");
  if (p.status !== "OPEN") throw new SocialError(`This proposal is already ${p.status.toLowerCase()}`);
  await db.groupVote.upsert({
    where: { proposalId_userId: { proposalId, userId } },
    update: { approve },
    create: { proposalId, userId, approve },
  });
  const signers = new Set(p.group.members.filter((m) => m.canSign).map((m) => m.userId));
  const votes = (await db.groupVote.findMany({ where: { proposalId } })).filter((v) => signers.has(v.userId));
  const yes = votes.filter((v) => v.approve).length;
  const no = votes.filter((v) => !v.approve).length;

  if (yes >= p.group.threshold) return executeProposal(p.id, yes, no);
  if (signers.size - no < p.group.threshold) {
    await db.groupProposal.update({ where: { id: p.id }, data: { status: "REJECTED" } });
    return { status: "REJECTED", yes, no };
  }
  return { status: "OPEN", yes, no };
}

/**
 * Locks an approved proposal's draft from the wallet it was drafted for. Claimed first, so two
 * last votes at once cannot both lock it. A failed or pending funding can be retried by a signer.
 */
export async function executeProposal(proposalId: string, yes = 0, no = 0, retry = false) {
  const claimed = await db.groupProposal.updateMany({ where: { id: proposalId, status: retry ? "FAILED" : "OPEN" }, data: { status: "EXECUTED" } });
  if (claimed.count !== 1) return { status: "EXECUTED", yes, no };
  const p = await db.groupProposal.findUniqueOrThrow({ where: { id: proposalId }, include: { group: { include: { company: true } } } });
  // A move on one of the shared wallet's deals that pays money out (release a milestone, pay an offer).
  const act = dealActionOf(p);
  if (act) {
    try {
      if (!p.group.company) throw new SocialError("This group has no shared wallet");
      const wallet = getAddress(p.group.company.walletAddress);
      const deals = await import("./bank/deals");
      const r =
        act.action === "accept" ? await deals.acceptAndPay(wallet, act.dealId) : await deals.buyerAction(wallet, act.dealId, "approve", act.index);
      const ok = "outcome" in r ? r.outcome.status === "success" : r.status === "FUNDED";
      if (!ok) await db.groupProposal.update({ where: { id: p.id }, data: { status: "FAILED" } });
      void deals.syncDeal(wallet, act.dealId).catch(() => null);
      return { status: ok ? "EXECUTED" : "FAILED", yes, no };
    } catch (err) {
      await db.groupProposal.update({ where: { id: p.id }, data: { status: "FAILED" } });
      throw err;
    }
  }
  // A payout: the shared account pays its members, all or nothing.
  if (p.payout) {
    try {
      const from = p.group.company ? await db.bankAccount.findUnique({ where: { ownerAddress: p.group.company.walletAddress.toLowerCase() } }) : null;
      if (!from) throw new SocialError("This group has no shared account");
      await payMany(from.id, payoutOf(p).map((r) => ({ userId: r.userId, minor: BigInt(r.amount) })), `group-payout:${p.id}`);
      return { status: "EXECUTED", yes, no };
    } catch (err) {
      await db.groupProposal.update({ where: { id: p.id }, data: { status: "FAILED" } });
      throw err instanceof SendError ? new SocialError(err.message) : err;
    }
  }
  const draft = await db.dealDraft.findUniqueOrThrow({ where: { id: p.draftId! } });
  try {
    const { funding } = await approveDraft(p.proposerId, getAddress(draft.walletAddress), draft.id, { viaGroup: true });
    // PENDING stays EXECUTED: the funding resumes when the draft is retried.
    if (funding.status !== "FUNDED" && funding.status !== "PENDING") {
      await db.groupProposal.update({ where: { id: p.id }, data: { status: "FAILED" } });
    }
    return { status: funding.status === "FUNDED" || funding.status === "PENDING" ? "EXECUTED" : "FAILED", yes, no, funding };
  } catch (err) {
    await db.groupProposal.update({ where: { id: p.id }, data: { status: "FAILED" } });
    throw err;
  }
}

/** A signer retries a payment the group approved but that failed to lock (e.g. balance too low then). */
export async function retryProposal(userId: string, proposalId: string) {
  const p = await db.groupProposal.findUnique({ where: { id: proposalId }, include: { group: { include: { members: true } } } });
  if (!p || !p.group.members.some((m) => m.userId === userId && m.canSign)) throw new SocialError("Proposal not found");
  if (p.status !== "FAILED") throw new SocialError("Only a failed payment can be executed again");
  const yes = (await db.groupVote.count({ where: { proposalId, approve: true } })) ;
  if (yes < p.group.threshold) throw new SocialError("This proposal was not approved");
  return executeProposal(proposalId, yes, 0, true);
}

/**
 * A member asks the signers to approve a money-moving move on one of the shared wallet's deals:
 * releasing a delivered milestone to the seller, or paying a seller's offer. One open vote per move;
 * asking again just counts the asker's yes.
 */
export async function proposeDealAction(userId: string, groupId: string, act: DealAction) {
  const g = await db.group.findFirst({ where: { id: groupId, members: { some: { userId } } }, include: { members: true } });
  if (!g) throw new SocialError("Group not found");
  const open = (await db.groupProposal.findMany({ where: { groupId, status: "OPEN", dealAction: { not: Prisma.AnyNull } } })).find((p) => {
    const a = dealActionOf(p);
    return a?.dealId === act.dealId && a.index === act.index && a.action === act.action;
  });
  const p = open ?? (await db.groupProposal.create({ data: { groupId, proposerId: userId, dealAction: act } }));
  const me = g.members.find((m) => m.userId === userId);
  if (me?.canSign) return { ...(await vote(userId, p.id, true)), threshold: g.threshold, group: g.name };
  const yes = await db.groupVote.count({ where: { proposalId: p.id, approve: true } });
  return { status: "OPEN", yes, no: 0, threshold: g.threshold, group: g.name };
}

/**
 * A signer proposes paying members out of the shared account (e.g. sharing what a sale earned).
 * It goes to the same N of M vote as a purchase; the proposer's own yes counts at once.
 */
export async function proposePayout(userId: string, groupId: string, list: Recipient[]) {
  const g = await db.group.findFirst({ where: { id: groupId, members: { some: { userId } } }, include: { members: true, company: true } });
  if (!g) throw new SocialError("Group not found");
  if (!g.company) throw new SocialError("This group has no shared account");
  let recipients;
  try {
    recipients = cleanRecipients(list);
  } catch (err) {
    throw err instanceof SendError ? new SocialError(err.message) : err;
  }
  // Members, or the proposer's accepted contacts (e.g. staff paid a salary): the vote decides.
  const allowed = await payoutRecipients(userId, groupId);
  if (recipients.some((r) => !allowed.some((a) => a.userId === r.userId))) throw new SocialError("A payout goes to members of the group or to your contacts");
  const p = await db.groupProposal.create({
    data: { groupId, proposerId: userId, payout: recipients.map((r) => ({ userId: r.userId, amount: r.minor.toString() })) },
  });
  const me = g.members.find((m) => m.userId === userId);
  if (me?.canSign) return vote(userId, p.id, true);
  return { status: "OPEN", yes: 0, no: 0 };
}

/** Who a payout from the group's account may go to: its members and the proposer's accepted contacts. */
export async function payoutRecipients(userId: string, groupId: string): Promise<{ userId: string; name: string; member: boolean }[]> {
  const [members, friends] = await Promise.all([
    db.groupMember.findMany({ where: { groupId }, include: { user: { select: { id: true, name: true } } } }),
    listFriends(userId),
  ]);
  const out = new Map<string, { userId: string; name: string; member: boolean }>();
  for (const m of members) out.set(m.userId, { userId: m.userId, name: m.user.name, member: true });
  for (const f of friends) if (f.status === "ACCEPTED" && !out.has(f.userId)) out.set(f.userId, { userId: f.userId, name: f.name, member: false });
  return [...out.values()];
}

// ------------------------------------------------------------------------------------------
// Group rules: changed by the same signer vote as a payment
// ------------------------------------------------------------------------------------------

export async function proposeRule(userId: string, groupId: string, input: { kind: "ADD_SIGNER" | "REMOVE_SIGNER" | "REMOVE_MEMBER" | "SET_THRESHOLD"; targetUserId?: string; threshold?: number }) {
  const g = await db.group.findFirst({ where: { id: groupId, members: { some: { userId } } }, include: { members: true } });
  if (!g) throw new SocialError("Group not found");
  const target = input.targetUserId ? g.members.find((m) => m.userId === input.targetUserId) : null;
  const signers = g.members.filter((m) => m.canSign).length;
  if (input.kind === "SET_THRESHOLD") {
    if (!input.threshold || input.threshold < 2 || input.threshold > signers) throw new SocialError(`Votes needed must be between 2 and the ${signers} signers`);
    if (input.threshold === g.threshold) throw new SocialError("That is already the rule");
  } else {
    if (!target) throw new SocialError("Choose a member of the group");
    // The owner is never voted out or stripped of signing: they leave (or hand over) themselves.
    if (target.role === "ADMIN" && input.kind !== "ADD_SIGNER") throw new SocialError("The group's owner cannot be removed or stop signing by a vote; only they can leave or hand over the group");
    if (input.kind === "ADD_SIGNER" && target.canSign) throw new SocialError("Already a signer");
    if (input.kind === "REMOVE_SIGNER" && (!target.canSign || signers - 1 < g.threshold)) {
      throw new SocialError(target.canSign ? `The group would have fewer signers than the ${g.threshold} votes needed; lower that first` : "Not a signer");
    }
    if (input.kind === "REMOVE_MEMBER" && target.canSign && signers - 1 < g.threshold) throw new SocialError(`The group would have fewer signers than the ${g.threshold} votes needed`);
  }
  const open = await db.groupRuleProposal.findFirst({ where: { groupId, status: "OPEN", kind: input.kind, targetUserId: input.targetUserId ?? null } });
  if (open) throw new SocialError("The same change is already up for a vote");
  const r = await db.groupRuleProposal.create({ data: { groupId, proposerId: userId, kind: input.kind, targetUserId: input.targetUserId ?? null, threshold: input.threshold ?? null } });
  if (g.members.find((m) => m.userId === userId)?.canSign) return ruleVote(userId, r.id, true);
  return { status: "OPEN" };
}

export async function ruleVote(userId: string, proposalId: string, approve: boolean) {
  const r = await db.groupRuleProposal.findUnique({ where: { id: proposalId }, include: { group: { include: { members: true, company: true } } } });
  const me = r?.group.members.find((m) => m.userId === userId);
  if (!r || !me) throw new SocialError("Proposal not found");
  if (!me.canSign) throw new SocialError("Only the group's signers vote on its rules");
  if (r.status !== "OPEN") throw new SocialError(`This change is already ${r.status.toLowerCase()}`);
  await db.groupRuleVote.upsert({ where: { proposalId_userId: { proposalId, userId } }, update: { approve }, create: { proposalId, userId, approve } });
  const signers = new Set(r.group.members.filter((m) => m.canSign).map((m) => m.userId));
  const votes = (await db.groupRuleVote.findMany({ where: { proposalId } })).filter((v) => signers.has(v.userId));
  const yes = votes.filter((v) => v.approve).length;
  const no = votes.filter((v) => !v.approve).length;
  if (signers.size - no < r.group.threshold) {
    await db.groupRuleProposal.update({ where: { id: r.id }, data: { status: "REJECTED", decidedAt: new Date() } });
    return { status: "REJECTED" };
  }
  if (yes < r.group.threshold) return { status: "OPEN" };
  const claimed = await db.groupRuleProposal.updateMany({ where: { id: r.id, status: "OPEN" }, data: { status: "EXECUTED", decidedAt: new Date() } });
  if (claimed.count !== 1) return { status: "EXECUTED" };
  const groupId = r.groupId;
  // Re-checked at execution: the group may have changed since the proposal.
  const now = await db.groupMember.findMany({ where: { groupId } });
  const nowSigners = now.filter((m) => m.canSign).length;
  const fail = async (why: string) => {
    await db.groupRuleProposal.update({ where: { id: r.id }, data: { status: "FAILED" } });
    throw new SocialError(why);
  };
  if (r.kind === "SET_THRESHOLD") {
    if (!r.threshold || r.threshold > nowSigners) return fail("Not enough signers for that rule any more");
    await db.group.update({ where: { id: groupId }, data: { threshold: r.threshold } });
  } else if (r.kind !== "ADD_SIGNER" && now.find((m) => m.userId === r.targetUserId)?.role === "ADMIN") {
    return fail("The group's owner cannot be removed or stop signing by a vote");
  } else if (r.kind === "ADD_SIGNER" || r.kind === "REMOVE_SIGNER") {
    if (r.kind === "REMOVE_SIGNER" && nowSigners - 1 < r.group.threshold) return fail("The group would have too few signers");
    await db.groupMember.update({ where: { groupId_userId: { groupId, userId: r.targetUserId! } }, data: { canSign: r.kind === "ADD_SIGNER" } });
    if (r.group.company) {
      await db.userWallet.updateMany({ where: { userId: r.targetUserId!, walletAddress: r.group.company.walletAddress }, data: { role: r.kind === "ADD_SIGNER" ? "APPROVER" : "VIEWER" } });
    }
  } else {
    const t = now.find((m) => m.userId === r.targetUserId);
    if (!t) return { status: "EXECUTED" };
    if (t.canSign && nowSigners - 1 < r.group.threshold) return fail("The group would have too few signers");
    await removeMember(groupId, t.userId, r.group.company?.walletAddress ?? null);
  }
  return { status: "EXECUTED" };
}

/** Open group proposals waiting for this signer's vote: payments and rule changes. */
export async function pendingVotes(userId: string) {
  const open = await db.groupProposal.findMany({
    where: { status: "OPEN", group: { members: { some: { userId, canSign: true } } }, votes: { none: { userId } } },
    include: { group: { select: { id: true, name: true, threshold: true } }, votes: true },
  });
  const drafts = await db.dealDraft.findMany({ where: { id: { in: draftIdsOf(open) } } });
  const byId = new Map(drafts.map((d) => [d.id, d]));
  const names = new Map((await db.user.findMany({ where: { id: { in: open.flatMap((p) => payoutOf(p).map((r) => r.userId)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return open.map((p) => ({
    proposalId: p.id,
    group: p.group,
    title: proposalTitle(p, byId.get(p.draftId ?? "")?.title, (id) => names.get(id ?? "") ?? "a member"),
    yes: p.votes.filter((v) => v.approve).length,
  }));
}
