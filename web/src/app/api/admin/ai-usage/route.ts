import { z } from "zod";

import { DEFAULT_PER_DAY, DEFAULT_PER_WEEK, setAllowance, topUsage } from "@/lib/ai-usage";
import { HttpError, errorResponse, requireAdmin } from "@/lib/guard";

/** Admin: this week's heaviest AI users and their limits. */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ defaults: { perDay: DEFAULT_PER_DAY(), perWeek: DEFAULT_PER_WEEK() }, users: await topUsage() });
  } catch (err) {
    return errorResponse(err);
  }
}

const Body = z.object({
  userId: z.string().min(1).max(40),
  perDay: z.number().int().min(0).max(100_000_000).nullable(),
  perWeek: z.number().int().min(0).max(500_000_000).nullable(),
  note: z.string().max(200).optional(),
});

/** Admin: a user's own limits (null: back to the default). 0 turns the team's AI off for them. */
export async function POST(req: Request) {
  try {
    const { user } = await requireAdmin();
    const b = Body.safeParse(await req.json().catch(() => null));
    if (!b.success) throw new HttpError(400, "Send { userId, perDay, perWeek }");
    return Response.json(await setAllowance(b.data.userId, b.data.perDay, b.data.perWeek, user.id, b.data.note));
  } catch (err) {
    return errorResponse(err);
  }
}
