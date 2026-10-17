import { z } from "zod";

import { llmConfigured } from "@/lib/agent";
import { AttachmentInput } from "@/lib/attachments";
import { groupMessages, postGroupMessage } from "@/lib/group-chat";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { prefsOf } from "@/lib/prefs";
import { SocialError } from "@/lib/social";

export const maxDuration = 300;

const asHttp = (e: unknown) => {
  throw e instanceof SocialError ? new HttpError(400, e.message) : e;
};

export async function GET(_req: Request, ctx: RouteContext<"/api/groups/[id]/chat">) {
  try {
    const { user } = await requireCustomer();
    const messages = await groupMessages(user.id, (await ctx.params).id).catch(asHttp);
    return new Response(JSON.stringify({ messages }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return errorResponse(err);
  }
}

const Body = z.object({
  text: z.string().max(2000).default(""),
  askAi: z.boolean().default(false),
  lang: z.enum(["en", "th"]).default("en"),
  attachment: AttachmentInput.optional(),
});

/** A member writes in the group chat (optionally with a file); with askAi the group's agent answers and reads the file. */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/[id]/chat">) {
  try {
    rateLimit(req, "group-chat", 120, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const body = Body.safeParse(await req.json());
    if (!body.success || (!body.data.text.trim() && !body.data.attachment)) throw new HttpError(400, "Write a message or attach a file");
    if (body.data.askAi) {
      rateLimit(req, "group-ai", 30, 60 * 60 * 1000);
      if (!llmConfigured()) throw new HttpError(503, "The AI agent is not configured.");
      if (!(await prefsOf(user.id)).aiChat) throw new HttpError(403, "Your AI chat is off. Turn it on in Profile & Privacy to ask the AI.");
    }
    const r = await postGroupMessage(user.id, (await ctx.params).id, body.data.text, body.data.askAi, body.data.lang, body.data.attachment).catch(asHttp);
    return Response.json(r, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
