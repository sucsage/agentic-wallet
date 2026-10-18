import { z } from "zod";

import { deviceFriends, friendAction } from "@/lib/device-chain/features";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

export const maxDuration = 60;

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("request"), username: z.string().min(2).max(60) }),
  z.object({ op: z.literal("accept"), friendshipId: z.string().max(40) }),
  z.object({ op: z.literal("remove"), friendshipId: z.string().max(40) }),
]);

/** Friends: list, ask by username, accept, remove. Payees are signed blocks (intent "payee"). */
export const GET = deviceRoute(async (device) => ({ friends: await deviceFriends(device) }));
export const POST = deviceRoute(async (device, body) => {
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  return friendAction(device, parsed.data);
});
