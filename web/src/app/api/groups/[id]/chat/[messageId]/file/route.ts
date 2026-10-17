import { groupMessageFile } from "@/lib/group-chat";
import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError } from "@/lib/social";

/** A file a member attached in the group chat, for members only. Images open inline, anything else downloads. */
export async function GET(_req: Request, ctx: RouteContext<"/api/groups/[id]/chat/[messageId]/file">) {
  try {
    const { user } = await requireCustomer();
    const { id, messageId } = await ctx.params;
    const f = await groupMessageFile(user.id, id, messageId).catch((e) => {
      throw e instanceof SocialError ? new HttpError(404, e.message) : e;
    });
    const inline = /^image\/(png|jpeg|webp|gif)$/.test(f.mime);
    return new Response(new Uint8Array(f.bytes), {
      headers: {
        "content-type": inline ? f.mime : f.mime.startsWith("text/") ? "text/plain; charset=utf-8" : "application/octet-stream",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'; img-src 'self'",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
