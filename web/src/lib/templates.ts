import "server-only";

import { z } from "zod";

import { db } from "./db";

/**
 * Deal templates: a deal saved without its other party, to reuse with someone else (or other
 * amounts). Using one never creates a deal by itself: the AI drafts a new preview from it, which
 * the user still confirms.
 */

export class TemplateError extends Error {}

const MAX_TEMPLATES = 30;

export const TemplateMilestone = z.object({
  name: z.string().trim().min(1).max(120),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Amounts like 1500 or 1500.50"),
  delivery: z.enum(["file", "parcel", "note"]).default("note"),
  acceptance: z.string().max(500).default(""),
  /** Days from the start; null when the deal had no due date. */
  dueDays: z.number().int().min(0).max(365).nullable().default(null),
});

export const TemplateInput = z.object({
  name: z.string().trim().min(1).max(80),
  side: z.enum(["BUY", "SELL"]),
  kind: z.enum(["HIRE", "GOODS"]),
  title: z.string().trim().min(1).max(160),
  summary: z.string().max(1000).default(""),
  milestones: z.array(TemplateMilestone).min(1).max(10),
});

export type TemplateView = z.infer<typeof TemplateInput> & { id: string; uses: number; total: string; updatedAt: string };

function view(t: { id: string; name: string; side: "BUY" | "SELL"; kind: "HIRE" | "GOODS"; title: string; summary: string; milestones: unknown; uses: number; updatedAt: Date }): TemplateView {
  const milestones = z.array(TemplateMilestone).parse(t.milestones);
  const total = milestones.reduce((s, m) => s + Math.round(Number(m.amount) * 100), 0);
  return { id: t.id, name: t.name, side: t.side, kind: t.kind, title: t.title, summary: t.summary, milestones, uses: t.uses, total: (total / 100).toFixed(2), updatedAt: t.updatedAt.toISOString() };
}

export async function listTemplates(userId: string): Promise<TemplateView[]> {
  const rows = await db.dealTemplate.findMany({ where: { userId }, orderBy: [{ uses: "desc" }, { updatedAt: "desc" }] });
  return rows.map(view);
}

/** Saves a template; the same name replaces the old one. */
export async function saveTemplate(userId: string, input: z.infer<typeof TemplateInput>): Promise<TemplateView> {
  const existing = await db.dealTemplate.findFirst({ where: { userId, name: { equals: input.name, mode: "insensitive" } } });
  if (existing) {
    return view(await db.dealTemplate.update({ where: { id: existing.id }, data: { ...input, milestones: input.milestones } }));
  }
  if ((await db.dealTemplate.count({ where: { userId } })) >= MAX_TEMPLATES) throw new TemplateError(`At most ${MAX_TEMPLATES} templates: delete one first`);
  return view(await db.dealTemplate.create({ data: { userId, ...input, milestones: input.milestones } }));
}

export async function deleteTemplate(userId: string, id: string) {
  const r = await db.dealTemplate.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw new TemplateError("Template not found");
}

export async function renameTemplate(userId: string, id: string, name: string) {
  const t = await db.dealTemplate.findFirst({ where: { id, userId } });
  if (!t) throw new TemplateError("Template not found");
  return view(await db.dealTemplate.update({ where: { id }, data: { name: name.trim().slice(0, 80) } }));
}

/** For the AI: a template by name (or id), counted as used. */
export async function takeTemplate(userId: string, nameOrId: string): Promise<TemplateView | null> {
  const q = nameOrId.trim();
  const t =
    (await db.dealTemplate.findFirst({ where: { userId, id: q } })) ??
    (await db.dealTemplate.findFirst({ where: { userId, name: { equals: q, mode: "insensitive" } } })) ??
    (await db.dealTemplate.findFirst({ where: { userId, OR: [{ name: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }] } }));
  if (!t) return null;
  await db.dealTemplate.update({ where: { id: t.id }, data: { uses: { increment: 1 } } });
  return view(t);
}
