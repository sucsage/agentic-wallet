import { z } from "zod";

import { db } from "@/lib/db";
import { HttpError, errorResponse, requireAdmin } from "@/lib/guard";
import { autoApprove, decideKyc } from "@/lib/onboarding";

/** KYC review queue: pending applications first, then the latest decisions (masked ids only). */
export async function GET() {
  try {
    await requireAdmin();
    const rows = await db.kycApplication.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 50,
      include: { user: { select: { email: true } } },
    });
    return Response.json({
      autoApprove: autoApprove(),
      applications: rows.map((r) => ({
        id: r.id,
        email: r.user.email,
        country: r.country,
        method: r.method,
        legalName: r.legalName,
        idType: r.idType,
        maskedId: r.maskedId,
        birthDate: r.birthDate,
        status: r.status,
        reviewer: r.reviewer,
        note: r.reviewNote,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** A reviewer approves (opens the wallet) or rejects an application, with a note. */
export async function POST(req: Request) {
  try {
    const { user } = await requireAdmin();
    const body = z.object({ id: z.string().max(40), approve: z.boolean(), note: z.string().max(500).default("") }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send id, approve and a note");
    const app = await db.kycApplication.findUnique({ where: { id: body.data.id } });
    if (!app) throw new HttpError(404, "Application not found");
    if (app.status !== "PENDING") throw new HttpError(409, `Already ${app.status.toLowerCase()}`);
    if (!body.data.approve && body.data.note.trim().length < 5) throw new HttpError(400, "Say why it is rejected (the applicant sees this)");
    const r = await decideKyc(app.id, body.data.approve, `admin:${user.id}`, body.data.note.trim() || undefined);
    return Response.json({ status: r.application.status });
  } catch (err) {
    return errorResponse(err);
  }
}
