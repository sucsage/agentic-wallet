import { errorResponse, requireUser } from "@/lib/guard";
import { unblockUser } from "@/lib/safety";

/** Unblocks. They are not a contact again until one of you sends a request. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/blocks/[userId]">) {
  try {
    const user = await requireUser();
    await unblockUser(user.id, (await ctx.params).userId);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
