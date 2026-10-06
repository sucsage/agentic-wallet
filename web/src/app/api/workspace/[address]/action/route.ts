import { z } from "zod";

import {
  approveProposal,
  cancelProposal,
  pause,
  rawAttack,
  restoreSession,
  revokeSession,
  submitEvidence,
  unpause,
} from "@/lib/actions";
import { HttpError, demoWallet, errorResponse, rateLimit } from "@/lib/guard";
import { readDeals } from "@/lib/state";

export const maxDuration = 60;

const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve"), id: z.number().int().min(0), role: z.enum(["approverA", "approverB"]) }),
  z.object({ type: z.literal("cancel"), id: z.number().int().min(0) }),
  z.object({ type: z.literal("pause"), role: z.enum(["owner", "approverA", "approverB", "agent"]) }),
  z.object({ type: z.literal("unpause") }),
  z.object({ type: z.literal("revoke_session") }),
  z.object({ type: z.literal("restore_session") }),
  z.object({
    type: z.literal("submit_evidence"),
    dealId: z.number().int().min(0),
    index: z.number().int().min(0),
    title: z.string().max(200),
    text: z.string().min(1).max(6000),
  }),
  z.object({ type: z.literal("raw_attack") }),
]);

export async function POST(req: Request, ctx: RouteContext<"/api/workspace/[address]/action">) {
  try {
    rateLimit(req, "action", 60, 60 * 60 * 1000);
    const wallet = await demoWallet((await ctx.params).address);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "Invalid request body");
    const a = parsed.data;

    switch (a.type) {
      case "approve":
        return Response.json(await approveProposal(wallet, a.id, a.role));
      case "cancel":
        return Response.json(await cancelProposal(wallet, a.id));
      case "pause":
        return Response.json(await pause(wallet, a.role));
      case "unpause":
        return Response.json(await unpause(wallet));
      case "revoke_session":
        return Response.json(await revokeSession(wallet));
      case "restore_session":
        return Response.json(await restoreSession(wallet));
      case "submit_evidence": {
        // Evidence can only be attached to this wallet's own deals.
        const deals = await readDeals(wallet);
        if (!deals.some((d) => d.id === a.dealId)) throw new HttpError(404, "Deal not found for this wallet");
        return Response.json(await submitEvidence(a.dealId, a.index, { title: a.title, text: a.text }));
      }
      case "raw_attack":
        return Response.json(await rawAttack(wallet));
    }
  } catch (err) {
    return errorResponse(err);
  }
}
