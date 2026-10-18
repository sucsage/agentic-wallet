import { z } from "zod";

import { topupInfo, topupStart } from "@/lib/device-chain/features";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

export const maxDuration = 60;

const Body = z.object({ amount: z.number().positive().max(1_000_000), method: z.enum(["card", "promptpay", "linked", "counter"]), returnTo: z.string().max(200).optional() });

/** Top-ups from the app: Stripe Checkout (card / PromptPay, back to the app's local page), the linked card, or a counter slip. */
export const GET = deviceRoute((device) => topupInfo(device));
export const POST = deviceRoute(async (device, body, req) => {
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Enter an amount");
  return topupStart(device, new URL(req.url).origin, parsed.data);
});
