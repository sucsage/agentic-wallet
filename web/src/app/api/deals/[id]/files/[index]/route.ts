import { DealError, deliveryFile } from "@/lib/bank/deals";
import { HttpError, errorResponse, requireBankWallet } from "@/lib/guard";

/** Downloads a milestone's file: the seller any time, the buyer once the escrow released the key. */
export async function GET(_req: Request, ctx: RouteContext<"/api/deals/[id]/files/[index]">) {
  try {
    const { wallet } = await requireBankWallet();
    const p = await ctx.params;
    const id = Number(p.id);
    const index = Number(p.index);
    if (!Number.isInteger(id) || !Number.isInteger(index)) throw new HttpError(400, "Invalid request");
    const f = await deliveryFile(wallet, id, index).catch((e) => {
      throw e instanceof DealError ? new HttpError(403, e.message) : e;
    });
    return new Response(new Uint8Array(f.bytes), {
      headers: {
        "content-type": f.mime,
        "content-disposition": `attachment; filename="${encodeURIComponent(f.name)}"`,
        "x-sha256": f.sha256,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
