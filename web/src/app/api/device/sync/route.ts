import { after } from "next/server";

import { anchorHeads, pendingFor } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";
import { db } from "@/lib/db";

export const maxDuration = 60;

/** The app's sync: its head as kept here, deal events to append, website moves waiting for its signature. */
export const GET = deviceRoute(async (device) => {
  // Heads are anchored at most hourly from syncs (and daily by the cron).
  after(async () => {
    const last = await db.chainAnchorRecord.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (!last || last.createdAt.getTime() < Date.now() - 60 * 60 * 1000) await anchorHeads().catch((e) => console.error("anchor", e));
  });
  return pendingFor(device);
});
