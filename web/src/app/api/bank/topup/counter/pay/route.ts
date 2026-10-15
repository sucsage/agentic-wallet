import { z } from "zod";

import { paySlip } from "@/lib/bank/counter";
import { TopupError } from "@/lib/bank/topup";
import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";

/** Demo only: simulates the cashier scanning the slip. Each slip pays in once. */
export async function POST(req: Request) {
  try {
    const { user } = await requireCustomer();
    const body = z.object({ slip: z.string().max(2000) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send the slip");
    const r = await paySlip(user.id, body.data.slip).catch((e) => {
      throw e instanceof TopupError ? new HttpError(400, e.message) : e;
    });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
