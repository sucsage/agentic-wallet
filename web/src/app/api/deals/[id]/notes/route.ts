import { z } from "zod";

import { NoteError, addBuyerNote } from "@/lib/bank/deal-notes";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

const Body = z.object({
  /** CHANGES: the buyer asks the seller to fix a delivery. REVISION: the buyer asks for a different offer. */
  kind: z.enum(["CHANGES", "REVISION"]),
  index: z.number().int().min(0).max(20).optional(),
  text: z.string().trim().min(5).max(1000),
});

/** A request from the buyer to the seller (lib/bank/deal-notes.ts). */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/notes">) {
  try {
    rateLimit(req, "deal-note", 30, 60 * 60 * 1000);
    const { wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(id) || !body.success) throw new HttpError(400, "Say what should change (at least 5 characters)");
    const note = await addBuyerNote(wallet, id, body.data).catch((e) => {
      throw e instanceof NoteError ? new HttpError(e.status, e.message) : e;
    });
    return Response.json({ id: note.id });
  } catch (err) {
    return errorResponse(err);
  }
}
