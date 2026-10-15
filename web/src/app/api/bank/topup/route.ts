import { z } from "zod";

import { TopupError, startTopup, topupLimit } from "@/lib/bank/topup";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

/** GET: the top-up limit (KYC-dependent). POST {amount}: a Stripe Checkout (test mode) URL. */
export async function GET() {
  try {
    const { user, customer } = await requireCustomer();
    return Response.json({ currency: customer.currency, limit: await topupLimit(user.id, customer.currency), enabled: Boolean(process.env.STRIPE_SECRET_KEY) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    rateLimit(req, "topup", 20, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const body = z.object({ amount: z.number().positive().max(1_000_000) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send an amount");
    const url = await startTopup(user.id, body.data.amount, new URL(req.url).origin).catch((e) => {
      throw e instanceof TopupError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ url });
  } catch (err) {
    return errorResponse(err);
  }
}
