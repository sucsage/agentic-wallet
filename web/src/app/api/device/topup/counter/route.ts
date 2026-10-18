import { counterPay } from "@/lib/device-chain/features";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

/** Demo cashier: pays a counter-service slip made in the app. */
export const POST = deviceRoute(async (device, body) => {
  const slip = (body as { slip?: unknown } | null)?.slip;
  if (typeof slip !== "string" || slip.length > 2000) throw new HttpError(400, "Invalid request");
  return counterPay(device, slip);
});
