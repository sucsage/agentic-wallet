import { deleteChat, getChat } from "@/lib/chats";
import { HttpError, errorResponse, requireUser, userWallet } from "@/lib/guard";

/** One saved chat, as the chat shows it. */
export async function GET(_req: Request, ctx: RouteContext<"/api/workspace/[address]/chats/[id]">) {
  try {
    const p = await ctx.params;
    const wallet = await userWallet(p.address);
    const user = await requireUser();
    const chat = await getChat(user.id, wallet, p.id);
    if (!chat) throw new HttpError(404, "Chat not found");
    return Response.json({ id: chat.id, title: chat.title, messages: chat.messages, updatedAt: chat.updatedAt });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Deletes a chat for good (drafts made in it stay in Approvals). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/workspace/[address]/chats/[id]">) {
  try {
    const p = await ctx.params;
    const wallet = await userWallet(p.address);
    const user = await requireUser();
    if (!(await deleteChat(user.id, wallet, p.id))) throw new HttpError(404, "Chat not found");
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
