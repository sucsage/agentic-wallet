import { DealError } from "@/lib/bank/deals";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";
import { GuarantorInput, removeGuarantor, saveGuarantor } from "@/lib/guarantors";

const asHttp = (e: unknown) => {
  throw e instanceof DealError ? new HttpError(400, e.message) : e;
};

/** This side's guarantor (ผู้ค้ำประกัน) on the deal: name, contact, relation and the amount guaranteed. */
export async function PUT(req: Request, ctx: RouteContext<"/api/deals/[id]/guarantor">) {
  try {
    rateLimit(req, "guarantor", 30, 60 * 60 * 1000);
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const body = GuarantorInput.safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(id) || !body.success) throw new HttpError(400, "Give the guarantor's name, a phone or email, and how they relate to you");
    await saveGuarantor(user.id, wallet, id, body.data).catch(asHttp);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/deals/[id]/guarantor">) {
  try {
    const { wallet } = await requireBankWallet();
    await removeGuarantor(wallet, Number((await ctx.params).id)).catch(asHttp);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
