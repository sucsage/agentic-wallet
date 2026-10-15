import { errorResponse, requireActingCustomer } from "@/lib/guard";
import { buildSummary, range, summaryCsv } from "@/lib/summary";

/** The summary as a CSV file (opens in Excel / Sheets). */
export async function GET(req: Request) {
  try {
    const { user, customer } = await requireActingCustomer();
    const { from, to } = range(req);
    const csv = summaryCsv(await buildSummary(user.id, customer, from, to));
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="agentic-wallet-summary-${from.toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
