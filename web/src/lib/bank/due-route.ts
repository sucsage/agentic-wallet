import "server-only";

import { z } from "zod";

import { HttpError } from "../guard";
import { DueError, dueAction } from "./milestone-due";

export const DueBody = z.object({ action: z.enum(["propose", "accept", "late"]), index: z.number().int().min(0).max(20), date: z.string().max(10).optional() });

export async function runDue(wallet: `0x${string}`, dealId: number, body: unknown) {
  const parsed = DueBody.safeParse(body);
  if (!parsed.success || !Number.isInteger(dealId)) throw new HttpError(400, "Invalid request");
  return { due: await dueAction(wallet, dealId, parsed.data).catch((e) => {
    throw e instanceof DueError ? new HttpError(400, e.message) : e;
  }) };
}
