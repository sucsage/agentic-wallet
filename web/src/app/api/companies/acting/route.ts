import { cookies } from "next/headers";
import { z } from "zod";

import { ACTING_COOKIE, actingCompany } from "@/lib/company";
import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";

/** Switches "Acting as": a company the user belongs to, or back to themselves (companyId null). */
export async function POST(req: Request) {
  try {
    const { user } = await requireCustomer();
    const body = z.object({ companyId: z.string().nullable() }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { companyId }");
    const jar = await cookies();
    if (!body.data.companyId) {
      jar.delete(ACTING_COOKIE);
      return Response.json({ acting: null });
    }
    const company = await actingCompany(user.id, body.data.companyId);
    if (!company) throw new HttpError(404, "Company not found");
    jar.set(ACTING_COOKIE, company.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return Response.json({ acting: { companyId: company.id, name: company.name } });
  } catch (err) {
    return errorResponse(err);
  }
}
