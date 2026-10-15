import { z } from "zod";

import { issueSlip } from "@/lib/bank/counter";
import { TopupError } from "@/lib/bank/topup";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

/** A counter-service payment slip (demo): reference + barcode, valid 24 hours. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "topup-counter", 20, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const body = z.object({ amount: z.number().positive().max(1_000_000) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send an amount");
    const slip = await issueSlip(user.id, body.data.amount).catch((e) => {
      throw e instanceof TopupError ? new HttpError(400, e.message) : e;
    });
    return Response.json(slip);
  } catch (err) {
    return errorResponse(err);
  }
}
