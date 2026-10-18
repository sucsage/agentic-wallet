import { DealError, arriveParcelNow } from "@/lib/bank/deals";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

/** Test mode: the Mock Post parcel of a milestone arrives now (see arriveParcelNow). */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/parcel">) {
  try {
    rateLimit(req, "parcel-now", 30, 60 * 60 * 1000);
    const { wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const { index } = (await req.json().catch(() => ({}))) as { index?: number };
    if (!Number.isInteger(id) || id < 0 || !Number.isInteger(index) || index! < 0) throw new HttpError(400, "Invalid deal or milestone");
    await arriveParcelNow(wallet, id, index!).catch((e) => {
      throw e instanceof DealError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
