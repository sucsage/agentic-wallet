import { usageOf } from "@/lib/ai-usage";
import { errorResponse, requireUser } from "@/lib/guard";

/** The signed-in user's AI tokens today and this week, against their allowance. */
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await usageOf(user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
