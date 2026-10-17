import { z } from "zod";

import { DealError, dealForWallet } from "@/lib/bank/deals";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

/**
 * Optional witnesses on a deal's contract: each side may name one (or none). They appear on the
 * exported contract; they have no power over the money.
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/deals/[id]/witness">) {
  try {
    rateLimit(req, "witness", 30, 60 * 60 * 1000);
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const body = z.object({ name: z.string().trim().min(2).max(120), contact: z.string().trim().max(160).default("") }).safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(id) || !body.success) throw new HttpError(400, "Give the witness's name (and optionally a phone or email)");
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    const escrow = config.fileEscrowOf(id);
    const w = await db.dealWitness.upsert({
      where: { escrow_dealId_side: { escrow, dealId: id, side: deal.role } },
      update: { name: body.data.name, contact: body.data.contact, addedById: user.id },
      create: { escrow, dealId: id, side: deal.role, name: body.data.name, contact: body.data.contact, addedById: user.id },
    });
    return Response.json({ witness: { side: w.side, name: w.name, contact: w.contact } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Removes this side's witness. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/deals/[id]/witness">) {
  try {
    const { wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    await db.dealWitness.deleteMany({ where: { escrow: config.fileEscrowOf(id), dealId: id, side: deal.role } });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
