import { submitBlocks } from "@/lib/device-chain";
import type { SignedBlock } from "@/lib/device-chain/format";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

export const maxDuration = 120;

/** The blocks the app appended since its head; intents (signed deal moves) run after the head moves. */
export const POST = deviceRoute(async (device, body) => {
  const blocks = (body as { blocks?: SignedBlock[] } | null)?.blocks;
  if (!Array.isArray(blocks)) throw new HttpError(400, "Invalid request");
  return submitBlocks(device, blocks);
});
