import { createWorkspace } from "@/lib/actions";
import { errorResponse, rateLimit } from "@/lib/guard";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    rateLimit(req, "create", 5, 60 * 60 * 1000);
    const { address, outcome } = await createWorkspace();
    return Response.json({ address, outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
