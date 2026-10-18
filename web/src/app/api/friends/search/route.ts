import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { SocialError, searchCustomers } from "@/lib/social";

/**
 * Finds customers of the same bank by part of their username or display name (at least 2
 * characters, at most 6 results), or by exact email, so a friend can be found without typing the
 * exact username.
 */
export async function GET(req: Request) {
  try {
    rateLimit(req, "friend-search", 120, 60 * 60 * 1000);
    const { user, customer } = await requireCustomer();
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const results = await searchCustomers(user.id, customer.currency, q).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ results });
  } catch (err) {
    return errorResponse(err);
  }
}
