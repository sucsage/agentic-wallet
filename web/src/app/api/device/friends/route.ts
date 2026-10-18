import { z } from "zod";

import { deviceFriendsView, friendAction } from "@/lib/device-chain/features";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

export const maxDuration = 60;

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("request"), username: z.string().min(2).max(80) }),
  z.object({ op: z.literal("search"), q: z.string().min(1).max(80) }),
  z.object({ op: z.literal("username"), username: z.string().min(2).max(40) }),
  z.object({ op: z.literal("accept"), friendshipId: z.string().max(40) }),
  z.object({ op: z.literal("remove"), friendshipId: z.string().max(40) }),
]);

/** Friends: list, search, ask by username / name / email, accept, remove, choose a username. Payees are signed blocks (intent "payee"). */
export const GET = deviceRoute(async (device) => deviceFriendsView(device));
export const POST = deviceRoute(async (device, body) => {
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  return friendAction(device, parsed.data);
});
