import { topupConfirm } from "@/lib/device-chain/features";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

/** The app's local page got the browser back from Stripe: credit the paid session (once). */
export const POST = deviceRoute(async (device, body) => {
  const id = (body as { sessionId?: unknown } | null)?.sessionId;
  if (typeof id !== "string") throw new HttpError(400, "Invalid request");
  return topupConfirm(device, id);
});
