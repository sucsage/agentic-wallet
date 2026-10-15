import { z } from "zod";

import { CompanyError, companiesOf, createCompany } from "@/lib/company";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

export const maxDuration = 120;

export async function GET() {
  try {
    const { user } = await requireCustomer();
    return Response.json({ companies: await companiesOf(user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

const Input = z.object({
  name: z.string().trim().min(2).max(80),
  taxId: z.string().trim().min(13).max(24),
  members: z.array(z.object({ userId: z.string(), canSign: z.boolean() })).min(1).max(20),
  threshold: z.number().int().min(2).max(21),
});

/** Registers a company account: its own wallet, run by N of M signers. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "company", 5, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const body = Input.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "Invalid input");
    const company = await createCompany(user.id, body.data).catch((e) => {
      throw e instanceof CompanyError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ id: company.id, wallet: company.walletAddress });
  } catch (err) {
    return errorResponse(err);
  }
}
