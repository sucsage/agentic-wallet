import { z } from "zod";

import { db } from "@/lib/db";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

/** The user's own instructions for the AI (also used by the website's chat). */
export const GET = deviceRoute(async (device) => {
  const p = await db.userPreference.findUnique({ where: { userId: device.userId }, select: { aiInstructions: true } });
  return { aiInstructions: p?.aiInstructions ?? "" };
});

export const POST = deviceRoute(async (device, body) => {
  const parsed = z.object({ aiInstructions: z.string().max(1000) }).safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Up to 1,000 characters");
  const aiInstructions = parsed.data.aiInstructions.trim() || null;
  await db.userPreference.upsert({ where: { userId: device.userId }, update: { aiInstructions }, create: { userId: device.userId, aiInstructions } });
  return { aiInstructions: aiInstructions ?? "" };
});
