import { MAX_FILE_BYTES } from "@/lib/bank/deals";
import { submitBlocks } from "@/lib/device-chain";
import type { SignedBlock } from "@/lib/device-chain/format";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

export const maxDuration = 120;

/**
 * A delivery from the app: multipart with `blocks` (JSON: the signed deliver intent, plus any
 * blocks before it) and optionally `file`. The block signs the file's sha256, checked here before
 * the file is encrypted and stored like a delivery from the website.
 */
export const POST = deviceRoute(async (device, _body, _req, raw) => {
  const form = await raw.form().catch((e) => (console.error("device deliver form", e), null));
  if (!form) throw new HttpError(400, "Send multipart form data");
  let blocks: SignedBlock[];
  try {
    blocks = JSON.parse(String(form.get("blocks") ?? ""));
  } catch {
    throw new HttpError(400, "Invalid blocks");
  }
  const f = form.get("file");
  let upload = null;
  if (f instanceof File && f.size > 0) {
    if (f.size > MAX_FILE_BYTES) throw new HttpError(413, "The file is larger than 4 MB");
    upload = { name: f.name.slice(0, 200), mime: f.type || "application/octet-stream", bytes: Buffer.from(await f.arrayBuffer()) };
  }
  return submitBlocks(device, blocks, upload);
});
