import { DealError, deliveryPreview } from "@/lib/bank/deals";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

/** A watermarked preview of a delivered image: either party, before or after approval. */
export async function GET(req: Request, ctx: RouteContext<"/api/deals/[id]/preview/[index]">) {
  try {
    rateLimit(req, "preview", 120, 60 * 60 * 1000);
    const { wallet } = await requireBankWallet();
    const p = await ctx.params;
    const id = Number(p.id);
    const index = Number(p.index);
    if (!Number.isInteger(id) || !Number.isInteger(index)) throw new HttpError(400, "Invalid request");
    const jpeg = await deliveryPreview(wallet, id, index).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    return new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
