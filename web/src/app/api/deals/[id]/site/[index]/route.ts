import { DealError, SITE_PREVIEW_HEADERS, deliverySite } from "@/lib/bank/deals";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

/** A delivered web page, sandboxed, for the device mockup on the deal page (either party). */
export async function GET(req: Request, ctx: RouteContext<"/api/deals/[id]/site/[index]">) {
  try {
    rateLimit(req, "site-preview", 120, 60 * 60 * 1000);
    const { wallet } = await requireBankWallet();
    const p = await ctx.params;
    const id = Number(p.id);
    const index = Number(p.index);
    if (!Number.isInteger(id) || !Number.isInteger(index)) throw new HttpError(400, "Invalid request");
    const html = await deliverySite(wallet, id, index).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    return new Response(html, { headers: SITE_PREVIEW_HEADERS });
  } catch (err) {
    return errorResponse(err);
  }
}
