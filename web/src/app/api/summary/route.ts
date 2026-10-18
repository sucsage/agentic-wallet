import { errorResponse, requireActingCustomer } from "@/lib/guard";
import { buildSummary, range, summaryWallet } from "@/lib/summary";

/** Income, spending and refunds by month and by deal, with a Thai tax estimate (code, not AI). */
export async function GET(req: Request) {
  try {
    const { user, customer, company } = await requireActingCustomer();
    const { from, to } = range(req);
    return Response.json(await buildSummary(user.id, customer, from, to, await summaryWallet(user.id, company)));
  } catch (err) {
    return errorResponse(err);
  }
}
