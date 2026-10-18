import { eventLinks } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

/** Which of the given events the other party's device chain also carries (the links between chains). */
export const POST = deviceRoute(async (device, body) => {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) throw new HttpError(400, "Invalid request");
  return { links: await eventLinks(device, ids as string[]) };
});
