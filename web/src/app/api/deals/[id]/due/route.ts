import { runDue } from "@/lib/bank/due-route";
import { errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

/** A milestone's due date: propose one, accept the other side's, or (buyer, late) ask for a refund. */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/due">) {
  try {
    rateLimit(req, "due", 60, 60 * 60 * 1000);
    const { wallet } = await requireBankWallet();
    return Response.json(await runDue(wallet, Number((await ctx.params).id), await req.json().catch(() => null)));
  } catch (err) {
    return errorResponse(err);
  }
}
