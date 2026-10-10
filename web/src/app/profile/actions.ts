"use server";

import { z } from "zod";

import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const ProfileInput = z.object({
  firstName: text(80),
  lastName: text(80),
  phone: text(32).refine((v) => v === null || /^\+?[0-9 ()-]{6,32}$/.test(v), "Invalid phone number"),
  dateOfBirth: z
    .string()
    .trim()
    .transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null))
    .refine((d) => d === null || (!Number.isNaN(d.getTime()) && d < new Date()), "Invalid date of birth"),
  organization: text(120),
  jobTitle: text(80),
  country: text(2)
    .transform((v) => v?.toUpperCase() ?? null)
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), "Use a 2-letter country code, e.g. TH"),
  locale: z.enum(["en", "th"]),
});

export type SaveProfileState = { ok: boolean; error?: string } | null;

export async function saveProfile(_prev: SaveProfileState, form: FormData): Promise<SaveProfileState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const parsed = ProfileInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;
  await db.profile.upsert({ where: { userId: session.user.id }, update: data, create: { userId: session.user.id, ...data } });
  const name = [data.firstName, data.lastName].filter(Boolean).join(" ");
  if (name && name !== session.user.name) await db.user.update({ where: { id: session.user.id }, data: { name } });
  return { ok: true };
}
