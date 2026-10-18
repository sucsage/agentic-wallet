import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { db } from "./db";
import { HttpError } from "./guard";

/**
 * AI allowance: tokens per user per day and per week on the team's AI key, so one user (or a
 * runaway agent loop) cannot spend everyone's budget. Days and weeks follow Bangkok time; a week
 * starts on Monday. Defaults: AI_TOKENS_PER_DAY (500,000) and AI_TOKENS_PER_WEEK (2,000,000); one chat message costs about 8,000 tokens (system prompt and tools), a deal drafted over several turns 50,000-150,000; an
 * admin can give one user other limits (AiAllowance). Calls on the user's own key are counted
 * apart and never limited (they pay for them). The arbiter's calls are the platform's, not a user's.
 *
 * Every LLM call site records usage with recordUsage(); the user comes from the async context set
 * by withAiUser() at the entry points (chat, group chat, summary, applicant ranking).
 */

export class AiLimitError extends HttpError {
  constructor(message: string) {
    super(429, message);
    this.name = "AiLimitError";
  }
}

type Ctx = { userId: string; ownKey: boolean };
const ctx = new AsyncLocalStorage<Ctx>();

/** Runs fn as this user's AI work (ownKey: on their own provider key, not limited). */
export const withAiUser = <T>(userId: string, fn: () => Promise<T>, ownKey = false) => ctx.run({ userId, ownKey }, fn);
export const aiUser = () => ctx.getStore();

const DAY_MS = 86_400_000;
const bangkok = (t = Date.now()) => new Date(t + 7 * 3_600_000);
export const dayKey = (t = Date.now()) => bangkok(t).toISOString().slice(0, 10);
/** Monday of the Bangkok week holding day `t`. */
function weekStart(t = Date.now()) {
  const d = bangkok(t);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return dayKey(t - back * DAY_MS);
}
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
export const DEFAULT_PER_DAY = () => envInt("AI_TOKENS_PER_DAY", 500_000);
export const DEFAULT_PER_WEEK = () => envInt("AI_TOKENS_PER_WEEK", 2_000_000);

export async function limitsOf(userId: string) {
  const a = await db.aiAllowance.findUnique({ where: { userId } });
  return { perDay: a?.perDay ?? DEFAULT_PER_DAY(), perWeek: a?.perWeek ?? DEFAULT_PER_WEEK(), custom: Boolean(a && (a.perDay !== null || a.perWeek !== null)) };
}

/** What the user spent today and this week, their limits and when each resets. */
export async function usageOf(userId: string) {
  const today = dayKey();
  const monday = weekStart();
  const rows = await db.aiUsage.findMany({ where: { userId, day: { in: days(monday, today) } } });
  const day = rows.find((r) => r.day === today);
  const limits = await limitsOf(userId);
  const week = rows.reduce((t, r) => t + r.tokens, 0);
  const nextDay = new Date(Date.parse(`${today}T00:00:00+07:00`) + DAY_MS);
  const nextWeek = new Date(Date.parse(`${monday}T00:00:00+07:00`) + 7 * DAY_MS);
  return {
    today: day?.tokens ?? 0,
    week,
    ownKeyToday: day?.ownKeyTokens ?? 0,
    callsToday: day?.calls ?? 0,
    perDay: limits.perDay,
    perWeek: limits.perWeek,
    custom: limits.custom,
    resetsDay: nextDay,
    resetsWeek: nextWeek,
  };
}

const when = (d: Date) => d.toLocaleString("en-GB", { timeZone: "Asia/Bangkok", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Throws AiLimitError when the user has spent today's or this week's allowance. Nothing to check
 * for work on the user's own key.
 */
export async function checkAllowance(userId?: string) {
  const c = ctx.getStore();
  const id = userId ?? c?.userId;
  if (!id || (c?.ownKey && c.userId === id)) return;
  const u = await usageOf(id);
  if (u.today >= u.perDay)
    throw new AiLimitError(`You used today's AI allowance (${u.perDay.toLocaleString()} tokens). It resets ${when(u.resetsDay)} (Bangkok). In the desktop app you can use your own AI key meanwhile.`);
  if (u.week >= u.perWeek)
    throw new AiLimitError(`You used this week's AI allowance (${u.perWeek.toLocaleString()} tokens). It resets ${when(u.resetsWeek)} (Bangkok). In the desktop app you can use your own AI key meanwhile.`);
}

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | null | undefined;

/** Adds one model response's tokens to the current user's day (no user in context: the platform's own call). */
export async function recordUsage(usage: Usage) {
  const c = ctx.getStore();
  if (!c || !usage) return;
  const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  if (tokens <= 0) return;
  const day = dayKey();
  const add = c.ownKey ? { ownKeyTokens: { increment: tokens }, calls: { increment: 1 } } : { tokens: { increment: tokens }, calls: { increment: 1 } };
  await db.aiUsage
    .upsert({ where: { userId_day: { userId: c.userId, day } }, update: add, create: { userId: c.userId, day, ...(c.ownKey ? { ownKeyTokens: tokens } : { tokens }), calls: 1 } })
    .catch((e) => console.error("ai usage", e));
}

/** Admin: who spent the most this week, with their limits. */
export async function topUsage(limit = 50) {
  const monday = weekStart();
  const rows = await db.aiUsage.groupBy({ by: ["userId"], where: { day: { gte: monday } }, _sum: { tokens: true, ownKeyTokens: true, calls: true }, orderBy: { _sum: { tokens: "desc" } }, take: limit });
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true, email: true } });
  return Promise.all(
    rows.map(async (r) => {
      const u = users.find((x) => x.id === r.userId);
      return { userId: r.userId, name: u?.name ?? "", email: u?.email ?? "", ownKeyWeek: r._sum.ownKeyTokens ?? 0, callsWeek: r._sum.calls ?? 0, ...(await usageOf(r.userId)) };
    }),
  );
}

export async function setAllowance(userId: string, perDay: number | null, perWeek: number | null, setBy: string, note?: string) {
  await db.aiAllowance.upsert({ where: { userId }, update: { perDay, perWeek, setBy, note: note ?? null }, create: { userId, perDay, perWeek, setBy, note: note ?? null } });
  return usageOf(userId);
}
