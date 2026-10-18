import { DealError, deliveryPreview } from "@/lib/bank/deals";
import { deviceWallet } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

export const maxDuration = 60;

/** The watermarked preview of a delivered image or PDF page, for the desktop app (either party; the same rules as the website). */
export const POST = deviceRoute(async (device, body) => {
  const b = (body ?? {}) as { dealId?: unknown; index?: unknown; page?: unknown };
  const dealId = Number(b.dealId), index = Number(b.index), page = Number(b.page ?? 1);
  if (![dealId, index, page].every(Number.isInteger)) throw new HttpError(400, "Invalid request");
  const { jpeg, pages } = await deliveryPreview(deviceWallet(device), dealId, index, page).catch((e) => {
    throw e instanceof DealError ? new HttpError(404, e.message) : e;
  });
  return { jpeg: jpeg.toString("base64"), pages };
}, { acting: true });
