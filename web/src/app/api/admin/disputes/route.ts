import { z } from "zod";

import { ArbiterError, disputeView, disputesForReview, humanResolve } from "@/lib/bank/arbiter";
import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit, requireAdmin } from "@/lib/guard";

export const maxDuration = 60;

/** Disputes the AI arbiter left for a human (low confidence or no model), with its findings. */
export async function GET() {
  try {
    await requireAdmin();
    const rows = await disputesForReview();
    const disputes = await Promise.all(
      rows.map(async (d) => {
        // Deal ids are per escrow, and each deployment has its own schema, so the id finds the terms.
        const terms = await db.dealDraft.findFirst({ where: { dealId: d.dealId }, select: { title: true } });
        return { id: d.id, dealId: d.dealId, index: d.index, title: terms?.title ?? null, ...disputeView(d) };
      }),
    );
    return Response.json({ disputes });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The human arbiter's ruling: resolve on-chain with the arbiter key. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "arbiter", 30, 60 * 60 * 1000);
    const { user } = await requireAdmin();
    // sellerBps: the seller's share (0-10,000). toSeller is the older all-or-nothing form.
    const body = z
      .object({ id: z.string(), sellerBps: z.number().int().min(0).max(10_000).optional(), toSeller: z.boolean().optional(), note: z.string().min(10).max(1000) })
      .refine((b) => b.sellerBps !== undefined || b.toSeller !== undefined)
      .safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { id, sellerBps (0-10000), note } (note: at least 10 characters)");
    const bps = body.data.sellerBps ?? (body.data.toSeller ? 10_000 : 0);
    const outcome = await humanResolve(body.data.id, user.id, bps, body.data.note).catch((e) => {
      throw e instanceof ArbiterError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
