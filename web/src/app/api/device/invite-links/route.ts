import { z } from "zod";

import { deviceLinks, linkAction } from "@/lib/device-chain/features";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

export const maxDuration = 60;

const Body = z.object({ dealId: z.number().int().min(0), action: z.enum(["otp", "reset", "rotate"]), code: z.string().max(12).optional() });

/** Private links of people without an account that this user made: the link, its one-time code, resets. */
export const GET = deviceRoute(async (device, _b, req) => ({ links: await deviceLinks(device, new URL(req.url).origin) }), { acting: true });
export const POST = deviceRoute(async (device, body, req) => {
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  return linkAction(device, new URL(req.url).origin, parsed.data);
}, { acting: true });
