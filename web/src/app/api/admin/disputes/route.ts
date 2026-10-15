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
    const body = z.object({ id: z.string(), toSeller: z.boolean(), note: z.string().min(10).max(1000) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { id, toSeller, note } (note: at least 10 characters)");
    const outcome = await humanResolve(body.data.id, user.id, body.data.toSeller, body.data.note).catch((e) => {
      throw e instanceof ArbiterError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
