import { z } from "zod";

import { topupFromLink } from "@/lib/bank/stripe-link";
import { TopupError } from "@/lib/bank/topup";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

/** One-tap top-up from the linked card; `requestId` makes a double tap charge once. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "topup-linked", 20, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const body = z.object({ amount: z.number().positive().max(1_000_000), requestId: z.string().min(8).max(64) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send an amount and a request id");
    const r = await topupFromLink(user.id, body.data.amount, body.data.requestId).catch((e) => {
      throw e instanceof TopupError ? new HttpError(400, e.message) : e;
    });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
