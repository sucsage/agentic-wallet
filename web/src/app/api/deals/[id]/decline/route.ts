import { DealError, dealForWallet } from "@/lib/bank/deals";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { HttpError, errorResponse, requireBankWallet } from "@/lib/guard";

/**
 * Turns down an offer the other side made. Only an offer's creator can cancel it on-chain (a buyer's
 * offer also holds the buyer's money), so declining is recorded: it leaves this user's Approvals and
 * the creator is told, so they can withdraw it.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/deals/[id]/decline">) {
  try {
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 0) throw new HttpError(400, "Invalid deal id");
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    if (deal.status !== "Proposed" || deal.offeredBy !== "them") throw new HttpError(400, "Only an open offer from the other side can be declined");
    const escrow = config.bankContracts.fileEscrow;
    await db.declinedOffer.upsert({
      where: { userId_escrow_dealId: { userId: user.id, escrow, dealId: id } },
      update: {},
      create: { userId: user.id, escrow, dealId: id },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
