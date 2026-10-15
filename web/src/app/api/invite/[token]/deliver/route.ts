import { after } from "next/server";
import { getAddress } from "viem";

import { DealError, MAX_FILE_BYTES, deliver, syncDeal } from "@/lib/bank/deals";
import { InviteError, inviteByToken } from "@/lib/bank/invites";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

export const maxDuration = 120;

/** The invited seller delivers: multipart `dealId`, `index`, `note` and optionally `file` (max 4 MB). */
export async function POST(req: Request, ctx: RouteContext<"/api/invite/[token]/deliver">) {
  try {
    rateLimit(req, "invite-deliver", 30, 60 * 60 * 1000);
    const invite = await inviteByToken((await ctx.params).token).catch((e) => {
      throw e instanceof InviteError ? new HttpError(404, e.message) : e;
    });
    const form = await req.formData().catch(() => null);
    if (!form) throw new HttpError(400, "Send multipart form data");
    const dealId = Number(form.get("dealId"));
    const index = Number(form.get("index") ?? 0);
    if (!Number.isInteger(dealId) || !Number.isInteger(index)) throw new HttpError(400, "Invalid deal or milestone");
    const note = String(form.get("note") ?? "").slice(0, 4000);
    const f = form.get("file");
    let file: { name: string; mime: string; bytes: Buffer } | null = null;
    if (f instanceof File && f.size > 0) {
      if (f.size > MAX_FILE_BYTES) throw new HttpError(413, "The file is larger than 4 MB");
      file = { name: f.name.slice(0, 200), mime: f.type || "application/octet-stream", bytes: Buffer.from(await f.arrayBuffer()) };
    }
    const wallet = getAddress(invite.sellerWallet);
    const result = await deliver(`invite:${invite.id}`, wallet, dealId, index, { note, file }).catch((e) => {
      throw e instanceof DealError ? new HttpError(400, e.message) : e;
    });
    after(() => syncDeal(wallet, dealId).catch((e) => console.error("syncDeal", dealId, e)));
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
