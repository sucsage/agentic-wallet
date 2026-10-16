import { z } from "zod";

import { DealError, dealForWallet } from "@/lib/bank/deals";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

const Body = z.object({
  /** CHANGES: the buyer asks the seller to fix a delivery. REVISION: the buyer asks for a different offer. */
  kind: z.enum(["CHANGES", "REVISION"]),
  index: z.number().int().min(0).max(20).optional(),
  text: z.string().trim().min(5).max(1000),
});

/**
 * A request from the buyer to the seller. Off-chain only: asking for changes does not stop the
 * review window on-chain, so the buyer still disputes before it ends if the fix does not come.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/notes">) {
  try {
    rateLimit(req, "deal-note", 30, 60 * 60 * 1000);
    const { wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(id) || !body.success) throw new HttpError(400, "Say what should change (at least 5 characters)");
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    if (deal.role !== "buyer") throw new HttpError(403, "Only the buyer asks for changes");
    const { kind, index, text } = body.data;
    if (kind === "CHANGES") {
      const m = deal.milestones[index ?? -1];
      if (!m || m.status !== "Delivered") throw new HttpError(400, "Changes can be asked for while a delivery is under review");
    } else if (deal.status !== "Proposed" || deal.offeredBy !== "them") {
      throw new HttpError(400, "A revision can be asked for only on an offer from the seller that is still open");
    }
    const note = await db.dealNote.create({ data: { escrow: config.fileEscrowOf(id), dealId: id, index: index ?? null, kind, author: "buyer", text } });
    return Response.json({ id: note.id });
  } catch (err) {
    return errorResponse(err);
  }
}
