import { linkOf, startLink, unlink } from "@/lib/bank/stripe-link";
import { TopupError } from "@/lib/bank/topup";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { publicOrigin } from "@/lib/origins";

/** The card linked through Stripe as a funding source (GET), link one (POST), unlink (DELETE). */
export async function GET() {
  try {
    const { user } = await requireCustomer();
    const l = await linkOf(user.id);
    return Response.json({ enabled: Boolean(process.env.STRIPE_SECRET_KEY), link: l ? { brand: l.brand, last4: l.last4, exp: `${l.expMonth}/${l.expYear % 100}`, since: l.createdAt } : null });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    rateLimit(req, "stripe-link", 20, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const url = await startLink(user.id, publicOrigin(req)).catch((e) => {
      throw e instanceof TopupError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ url });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  try {
    const { user } = await requireCustomer();
    return Response.json({ unlinked: await unlink(user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}
