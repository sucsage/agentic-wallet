import { DealError, deliveryFile } from "@/lib/bank/deals";
import { fileResponse } from "@/lib/deal-files";
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
    // PDFs and images open in place (preview), anything else downloads; nothing runs.
    const res = fileResponse(f);
    res.headers.set("x-sha256", f.sha256);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
