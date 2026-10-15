import { z } from "zod";

import { CompanyError, fundCompany } from "@/lib/company";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

/** A member moves money from their own wallet into the company account. */
export async function POST(req: Request, ctx: RouteContext<"/api/companies/[id]/fund">) {
  try {
    rateLimit(req, "company-fund", 30, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const body = z.object({ amount: z.number().positive(), requestId: z.string().min(8).max(64) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { amount, requestId }");
    await fundCompany(user.id, (await ctx.params).id, body.data.amount, body.data.requestId).catch((e) => {
      throw e instanceof CompanyError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
