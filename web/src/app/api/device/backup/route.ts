import { loadBackup, saveBackup } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

/** The device's chain, encrypted on the device (the server cannot read it): restore after a lost disk. */
export const GET = deviceRoute((device) => loadBackup(device));

export const POST = deviceRoute(async (device, body) => {
  const b = body as { data?: unknown; height?: unknown } | null;
  if (typeof b?.data !== "string" || typeof b.height !== "number") throw new HttpError(400, "Invalid request");
  await saveBackup(device, b.data, b.height);
  return { ok: true };
});
