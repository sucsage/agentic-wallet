import { z } from "zod";

import { HttpError, errorResponse, requireAdmin } from "@/lib/guard";
import { closeReport, openReports } from "@/lib/safety";

/** Admins: open user reports. */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ reports: await openReports() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Admins: closes a report once reviewed. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = z.object({ id: z.string().min(1).max(64) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Give the report id");
    await closeReport(body.data.id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
