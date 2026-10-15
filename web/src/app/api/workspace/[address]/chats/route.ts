import { MAX_CHATS, listChats } from "@/lib/chats";
import { errorResponse, requireUser, userWallet } from "@/lib/guard";

/** The user's saved AI chats for this wallet, newest first (a new one starts with the first message). */
export async function GET(_req: Request, ctx: RouteContext<"/api/workspace/[address]/chats">) {
  try {
    const wallet = await userWallet((await ctx.params).address);
    const user = await requireUser();
    return Response.json({ chats: await listChats(user.id, wallet), max: MAX_CHATS });
  } catch (err) {
    return errorResponse(err);
  }
}
