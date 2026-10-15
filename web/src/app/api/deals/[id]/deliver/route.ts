import { after } from "next/server";

import { DealError, MAX_FILE_BYTES, deliver, syncDeal } from "@/lib/bank/deals";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";
import { CARRIERS, type Carrier } from "@/lib/post";

export const maxDuration = 120;

/**
 * The seller delivers a milestone: multipart form with `index`, `note` (the evidence: what was
 * delivered and how it meets the acceptance criteria) and optionally `file` (max 4 MB). The file is
 * encrypted and stored; only its sha256 goes on-chain. A parcel milestone sends `carrier` and
 * `tracking` instead (MOCK_POST without a tracking number books the parcel).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/deliver">) {
  try {
    rateLimit(req, "deliver", 30, 60 * 60 * 1000);
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const form = await req.formData().catch(() => null);
    if (!Number.isInteger(id) || !form) throw new HttpError(400, "Send multipart form data");
    const index = Number(form.get("index") ?? 0);
    const note = String(form.get("note") ?? "").slice(0, 4000);
    const f = form.get("file");
    let file: { name: string; mime: string; bytes: Buffer } | null = null;
    if (f instanceof File && f.size > 0) {
      if (f.size > MAX_FILE_BYTES) throw new HttpError(413, "The file is larger than 4 MB");
      file = { name: f.name.slice(0, 200), mime: f.type || "application/octet-stream", bytes: Buffer.from(await f.arrayBuffer()) };
    }
    const carrier = String(form.get("carrier") ?? "");
    if (carrier && !CARRIERS.includes(carrier as Carrier)) throw new HttpError(400, "Unknown carrier");
    const parcel = carrier ? { carrier: carrier as Carrier, tracking: String(form.get("tracking") ?? "").slice(0, 40) || undefined } : null;
    const result = await deliver(user.id, wallet, id, index, { note, file, parcel }).catch((e) => {
      throw e instanceof DealError ? new HttpError(400, e.message) : e;
    });
    after(() => syncDeal(wallet, id).catch((e) => console.error("syncDeal", id, e)));
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
