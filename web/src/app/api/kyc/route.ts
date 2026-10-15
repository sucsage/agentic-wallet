import { z } from "zod";

import { LIMITS, kycOf } from "@/lib/kyc";
import { HttpError, errorResponse, rateLimit, requireUser } from "@/lib/guard";
import { db } from "@/lib/db";
import { KycError, autoApprove, submitKyc } from "@/lib/onboarding";

/** The user's identity verification: the application (onboarding) and, once approved, the limits. */
export async function GET() {
  try {
    const user = await requireUser();
    const [application, kyc, customer] = await Promise.all([
      db.kycApplication.findUnique({ where: { userId: user.id } }),
      kycOf(user.id),
      db.bankCustomer.findUnique({ where: { userId: user.id } }),
    ]);
    const currency = customer?.currency ?? (application?.country === "CN" ? "CNY" : "THB");
    return Response.json({
      currency,
      provider: currency === "THB" ? "THAID" : "CN_NETID",
      autoApprove: autoApprove(),
      application: application
        ? { status: application.status, method: application.method, maskedId: application.maskedId, legalName: application.legalName, note: application.reviewNote, at: application.createdAt }
        : null,
      verified: kyc ? { provider: kyc.provider, maskedId: kyc.maskedId, name: kyc.verifiedName, at: kyc.verifiedAt } : null,
      limits: LIMITS[currency],
    });
  } catch (err) {
    return errorResponse(err);
  }
}

const Document = z.object({
  country: z.enum(["TH", "CN"]),
  legalName: z.string().trim().min(2).max(120),
  idType: z.enum(["NATIONAL_ID", "PASSPORT"]),
  idNumber: z.string().trim().min(6).max(20),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Submits identity details typed in (method DOCUMENT). The demo approves at once. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "kyc-submit", 20, 60 * 60 * 1000);
    const user = await requireUser();
    const body = Document.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "Check the form");
    const r = await submitKyc(user.id, { method: "DOCUMENT", ...body.data }).catch((e) => {
      throw e instanceof KycError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ status: r.application.status, opened: Boolean(r.customer) });
  } catch (err) {
    return errorResponse(err);
  }
}
