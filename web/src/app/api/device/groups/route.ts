import { z } from "zod";

import { deviceGroups, groupAction } from "@/lib/device-chain/features";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

export const maxDuration = 60;

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), name: z.string().trim().min(2).max(60), members: z.array(z.object({ userId: z.string().max(40), canSign: z.boolean() })).min(1).max(20), threshold: z.number().int().min(2) }),
  z.object({ op: z.literal("invite"), inviteId: z.string().max(40), accept: z.boolean() }),
]);

/** Groups: list, invitations, payments waiting for this signer's vote (votes are signed blocks), create. */
export const GET = deviceRoute((device) => deviceGroups(device));
export const POST = deviceRoute(async (device, body) => {
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  return groupAction(device, parsed.data);
});
