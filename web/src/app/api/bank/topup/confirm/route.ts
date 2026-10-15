import { z } from "zod";

import { TopupError, confirmTopup } from "@/lib/bank/topup";
import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";

/** After Stripe redirects back: checks the Checkout Session with Stripe and credits it once. */
export async function POST(req: Request) {
  try {
    const { user } = await requireCustomer();
    const body = z.object({ session: z.string().max(200) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send the session id");
    const r = await confirmTopup(user.id, body.data.session).catch((e) => {
      throw e instanceof TopupError ? new HttpError(400, e.message) : e;
    });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
