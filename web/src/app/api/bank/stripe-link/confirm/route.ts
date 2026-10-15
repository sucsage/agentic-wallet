import { z } from "zod";

import { confirmLink } from "@/lib/bank/stripe-link";
import { TopupError } from "@/lib/bank/topup";
import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";

/** After Stripe's page: checks the setup session with Stripe and records the saved card. */
export async function POST(req: Request) {
  try {
    const { user } = await requireCustomer();
    const body = z.object({ session: z.string().max(200) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send the session id");
    const card = await confirmLink(user.id, body.data.session).catch((e) => {
      throw e instanceof TopupError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ brand: card.brand, last4: card.last4 });
  } catch (err) {
    return errorResponse(err);
  }
}
