import { z } from "zod";

import { linkOf } from "@/lib/bank/stripe-link";
import { TopupError, startTopup, topupHistory, topupLimit } from "@/lib/bank/topup";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

/** GET: limit (KYC-dependent), linked card, recent top-ups. POST {amount, method}: a Stripe Checkout URL. */
export async function GET() {
  try {
    const { user, customer } = await requireCustomer();
    const [limit, link, history] = await Promise.all([topupLimit(user.id, customer.currency), linkOf(user.id), topupHistory(user.id)]);
    return Response.json({
      currency: customer.currency,
      limit,
      enabled: Boolean(process.env.STRIPE_SECRET_KEY),
      card: link ? { brand: link.brand, last4: link.last4 } : null,
      history,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    rateLimit(req, "topup", 20, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const body = z
      .object({ amount: z.number().positive().max(1_000_000), method: z.enum(["card", "promptpay"]).default("card") })
      .safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send an amount");
    const url = await startTopup(user.id, body.data.amount, new URL(req.url).origin, body.data.method).catch((e) => {
      throw e instanceof TopupError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ url });
  } catch (err) {
    return errorResponse(err);
  }
}
