import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import type { AgentStep, ChatTurn } from "./agent";
import { redactAddresses } from "./agent";
import { db } from "./db";

/**
 * Saved AI chats: up to five per wallet, like a chat app's history. The server keeps the
 * conversation and builds the model's history from it, so a browser cannot rewrite what the agent
 * was told earlier. Stored steps are what the chat shows: tool name, redacted summary, draft card.
 */
export const MAX_CHATS = 5;

export class ChatLimitError extends Error {}

export type StoredStep = { tool: string; summary: string; draft?: AgentStep["draft"] };
export type StoredItem =
  | { kind: "user"; text: string; at: string }
  | { kind: "agent"; text: string; at: string; steps: StoredStep[] }
  | { kind: "error"; text: string; at: string };

export const publicStep = (s: AgentStep): StoredStep => ({
  tool: s.tool,
  summary: redactAddresses(s.summary).slice(0, 800),
  ...(s.draft ? { draft: s.draft } : {}),
});

export function listChats(userId: string, wallet: string) {
  return db.agentChat.findMany({
    where: { userId, walletAddress: wallet },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
}

export function getChat(userId: string, wallet: string, id: string) {
  return db.agentChat.findFirst({ where: { id, userId, walletAddress: wallet } });
}

export async function createChat(userId: string, wallet: string, firstMessage: string) {
  const count = await db.agentChat.count({ where: { userId, walletAddress: wallet } });
  if (count >= MAX_CHATS) throw new ChatLimitError(`You have ${MAX_CHATS} chats. Delete one to start a new chat.`);
  const title = firstMessage.replace(/\s+/g, " ").trim().slice(0, 48) || "New chat";
  return db.agentChat.create({ data: { userId, walletAddress: wallet, title, messages: [] } });
}

export async function deleteChat(userId: string, wallet: string, id: string) {
  const { count } = await db.agentChat.deleteMany({ where: { id, userId, walletAddress: wallet } });
  return count > 0;
}

export async function appendToChat(id: string, items: StoredItem[]) {
  const chat = await db.agentChat.findUnique({ where: { id }, select: { messages: true } });
  if (!chat) return;
  // Keep the last 200 items; the model only ever sees the last 20 turns.
  const messages = [...((chat.messages as StoredItem[]) ?? []), ...items].slice(-200);
  await db.agentChat.update({ where: { id }, data: { messages: messages as unknown as Prisma.InputJsonValue } });
}

/** The model's view of a saved chat: user and agent text only, last 20 turns. */
export function historyOf(messages: unknown): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of (messages as StoredItem[]) ?? []) {
    if (m.kind === "error" || !m.text) continue;
    const role = m.kind === "user" ? ("user" as const) : ("assistant" as const);
    // A turn whose answer failed leaves two user messages in a row: merge them.
    const last = turns[turns.length - 1];
    if (last?.role === role) last.text += `\n\n${m.text}`;
    else turns.push({ role, text: m.text });
  }
  const recent = turns.slice(-20);
  return recent[0]?.role === "assistant" ? recent.slice(1) : recent;
}
