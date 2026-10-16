import "server-only";

import { db } from "./db";

/** The user's Profile & Privacy choices, with defaults for users who never changed them. */
export async function prefsOf(userId: string) {
  const p = await db.userPreference.findUnique({ where: { userId } });
  return { showAlso: p?.showAlso ?? null, aiChat: p?.aiChat ?? true, cardCover: p?.cardCover ?? true };
}

export type Prefs = Awaited<ReturnType<typeof prefsOf>>;

export async function setPrefs(userId: string, patch: Partial<Prefs>) {
  await db.userPreference.upsert({ where: { userId }, update: patch, create: { userId, ...patch } });
  return prefsOf(userId);
}
