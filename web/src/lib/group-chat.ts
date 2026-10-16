import "server-only";

import { type Address, getAddress } from "viem";

import { Prisma } from "@/generated/prisma/client";

import { type ChatTurn, runAgent } from "./agent";
import { type StoredStep, publicStep } from "./chats";
import { db } from "./db";
import { SocialError } from "./social";
import { primaryWalletAddress } from "./user-wallets";

/**
 * The group chat: members talk to each other, and anyone can ask the group's AI agent. With a
 * group (or company) wallet the agent works on that wallet, so what it proposes is a deal in the
 * group's name; without one it works on the asking member's own wallet, and a purchase it
 * proposes can then be put to the group's vote. Either way it only shows previews: the member who
 * asked confirms, and the signers vote. Messages stay in the app; only what is asked of the AI
 * (the recent conversation) goes to the model.
 */

const KEEP = 200;
const CONTEXT = 20;

export type GroupChatStep = StoredStep & { wallet: string; ownerId: string };

async function membership(userId: string, groupId: string) {
  const g = await db.group.findFirst({
    where: { id: groupId, members: { some: { userId } } },
    include: { members: { include: { user: { select: { id: true, name: true } } } }, company: true },
  });
  if (!g) throw new SocialError("Group not found");
  return g;
}

export async function groupMessages(userId: string, groupId: string) {
  const g = await membership(userId, groupId);
  const rows = await db.groupMessage.findMany({ where: { groupId }, orderBy: { createdAt: "desc" }, take: 80 });
  const names = new Map(g.members.map((m) => [m.userId, m.user.name]));
  const missing = rows.map((r) => r.userId).filter((id): id is string => !!id && !names.has(id));
  if (missing.length) for (const u of await db.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })) names.set(u.id, u.name);
  // A preview card shows what happened to it since (confirmed, in a vote, locked, discarded).
  const stepsOf = (r: (typeof rows)[number]) => (r.steps as GroupChatStep[] | null) ?? [];
  const ids = rows.flatMap((r) => stepsOf(r).map((st) => st.draft?.id)).filter((x): x is string => !!x);
  const now = new Map((await db.dealDraft.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, dealId: true } })).map((d) => [d.id, d]));
  const voting = new Set((await db.groupProposal.findMany({ where: { draftId: { in: ids }, status: "OPEN" }, select: { draftId: true } })).map((p) => p.draftId));
  return rows.reverse().map((r) => ({
    id: r.id,
    ai: r.userId === null,
    mine: r.userId === userId,
    author: r.userId ? (names.get(r.userId) ?? "a former member") : "AI agent",
    text: r.text,
    steps: stepsOf(r).map((st) => {
      const d = st.draft && now.get(st.draft.id);
      return d ? { ...st, draft: { ...st.draft!, status: d.status, dealId: d.dealId }, inVote: voting.has(d.id), mine: st.ownerId === userId } : { ...st, mine: st.ownerId === userId };
    }),
    at: r.createdAt,
  }));
}

/** Who said what, as turns the model accepts (alternating, starting with the user). */
function turnsOf(rows: { userId: string | null; text: string }[], nameOf: (id: string) => string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const r of rows) {
    const role = r.userId ? "user" : "assistant";
    const text = r.userId ? `${nameOf(r.userId)}: ${r.text}` : r.text;
    const last = turns[turns.length - 1];
    if (last?.role === role) last.text += `\n${text}`;
    else turns.push({ role, text });
  }
  while (turns[0]?.role === "assistant") turns.shift();
  if (turns[turns.length - 1]?.role === "user") turns.pop();
  return turns;
}

export async function postGroupMessage(userId: string, groupId: string, text: string, askAi: boolean, lang: "en" | "th" = "en") {
  const g = await membership(userId, groupId);
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new SocialError("Write a message");
  const earlier = await db.groupMessage.findMany({ where: { groupId }, orderBy: { createdAt: "desc" }, take: CONTEXT });
  await db.groupMessage.create({ data: { groupId, userId, text: clean } });
  // Keep the chat bounded.
  const old = await db.groupMessage.findMany({ where: { groupId }, orderBy: { createdAt: "desc" }, skip: KEEP, select: { id: true } });
  if (old.length) await db.groupMessage.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  if (!askAi) return { ai: null };

  const nameOf = (id: string) => g.members.find((m) => m.userId === id)?.user.name ?? "a former member";
  const me = nameOf(userId);
  const wallet: Address | null = g.company ? getAddress(g.company.walletAddress) : await primaryWalletAddress(userId);
  if (!wallet) throw new SocialError("Open your wallet first");
  const signers = g.members.filter((m) => m.canSign);
  const context = [
    `This is the GROUP CHAT of "${g.name}". Several people write here; each message starts with its author's name. You are the group's AI agent. The person asking you now is ${me}: you act for them, and only they can confirm a preview you show.`,
    `Members: ${g.members.map((m) => `${m.user.name}${m.role === "ADMIN" ? " (owner)" : ""}${m.canSign ? " (signer)" : ""}`).join(", ")}. A deal or payout needs ${g.threshold} of the ${signers.length} signers' votes.`,
    g.company
      ? `The group has its own shared wallet ("${g.company.name}"): you work on it. A purchase or an offer to sell you propose is in the group's name; when ${me} confirms it, it goes to the signers' vote.`
      : `The group has no shared wallet, so you work on ${me}'s own wallet. A purchase you propose is paid from ${me}'s wallet: after ${me} confirms the preview, put it to "${g.name}" with propose_to_group only if they ask. Selling in the group's name needs a group wallet (the owner opens it on the Groups page).`,
    "Keep answers short; the whole group reads them.",
  ].join("\n");
  try {
    const { reply, steps } = await runAgent(wallet, turnsOf(earlier.reverse(), nameOf), `${me}: ${clean}`, undefined, undefined, lang, userId, undefined, context);
    const stored: GroupChatStep[] = steps.map((s) => ({ ...publicStep(s), wallet, ownerId: userId }));
    const ai = await db.groupMessage.create({
      data: { groupId, userId: null, text: reply || "(no answer)", steps: stored.length ? (stored as unknown as Prisma.InputJsonValue) : Prisma.JsonNull },
    });
    return { ai: ai.id };
  } catch (err) {
    await db.groupMessage.create({ data: { groupId, userId: null, text: `The AI could not answer: ${(err as Error).message.slice(0, 200)}` } });
    return { ai: null };
  }
}
