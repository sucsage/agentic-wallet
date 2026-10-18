import { z } from "zod";

import { DEAL_MOVES, runDealMove } from "@/lib/bank/deal-actions";
import { requestDeviceSignature } from "@/lib/device-chain";
import { HttpError, assertCompanySigner, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

export const maxDuration = 120;

const Body = z.object({
  action: z.enum(DEAL_MOVES as [string, ...string[]]),
  index: z.number().int().min(0).max(20).default(0),
  /** Dispute only: what is wrong, for the neutral arbiter. */
  reason: z.string().max(2000).optional(),
});

/**
 * A move on a deal, pressed by the user on the website (lib/bank/deal-actions). Delivering has its
 * own route (it carries a file). When the user turned on "My desktop app signs deal moves", the move
 * waits for their desktop app instead (lib/device-chain).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/action">) {
  try {
    rateLimit(req, "deal-action", 30, 60 * 60 * 1000);
    const { user, customer, wallet, company } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(id) || !parsed.success) throw new HttpError(400, "Invalid request");
    const { index, reason } = parsed.data;
    const action = parsed.data.action as (typeof DEAL_MOVES)[number];
    // A company's deals are moved by its signers; any member may still dispute a delivery.
    if (action !== "dispute") await assertCompanySigner(user.id, company);
    if (!company) {
      const waiting = await requestDeviceSignature(user.id, wallet, { dealId: id, action, index, reason });
      if (waiting) return Response.json({ deviceRequest: waiting });
    }
    return Response.json(await runDealMove({ userId: user.id, currency: customer.currency, wallet }, id, action, index, reason));
  } catch (err) {
    return errorResponse(err);
  }
}
