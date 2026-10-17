import { z } from "zod";

import { explainSummary, llmConfigured } from "@/lib/agent";
import { HttpError, errorResponse, rateLimit, requireActingCustomer } from "@/lib/guard";
import { buildSummary, range, summaryWallet } from "@/lib/summary";

export const maxDuration = 120;

/** The AI's plain-language read of the summary. It sees aggregates only, never names or accounts. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "summary-ai", 20, 60 * 60 * 1000);
    if (!llmConfigured()) throw new HttpError(503, "The AI is not configured");
    const { user, customer, company } = await requireActingCustomer();
    const body = z.object({ lang: z.enum(["en", "th"]).default("en") }).safeParse(await req.json().catch(() => ({})));
    const { from, to } = range(req);
    const s = await buildSummary(user.id, customer, from, to, await summaryWallet(user.id, company));
    const text = await explainSummary(
      { currency: s.currency, period: { from: s.from, to: s.to }, totals: s.totals, months: s.months, deals: s.deals, tax: s.tax },
      body.success ? body.data.lang : "en",
    );
    return Response.json({ summary: text, numbers: s });
  } catch (err) {
    return errorResponse(err);
  }
}
