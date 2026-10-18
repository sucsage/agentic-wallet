import { createLinkCode } from "@/lib/device-chain";
import { errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

/** Profile → Desktop app: a one-time code (10 minutes) to type into the app. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "device-link-code", 20, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    return Response.json(await createLinkCode(user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
