import { prefsOf } from "@/lib/prefs";
import { z } from "zod";

import { llmConfigured, runAgent } from "@/lib/agent";
import { AttachmentInput, attachmentText } from "@/lib/attachments";
import { ChatLimitError, appendToChat, createChat, getChat, historyOf, publicStep } from "@/lib/chats";
import { HttpError, errorResponse, rateLimit, requireUser, userWallet } from "@/lib/guard";
import { scanForInjection } from "@/lib/policy";
import { readWallet } from "@/lib/state";

export const maxDuration = 300;

const Body = z.object({
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) }))
    .max(30)
    .default([]),
  message: z.string().max(4000).default(""),
  lang: z.enum(["en", "th"]).default("en"),
  /** A saved chat to continue, or "new" to start one (max 20). Without it nothing is saved. */
  chatId: z.string().max(40).optional(),
  attachment: AttachmentInput.optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/workspace/[address]/agent">) {
  try {
    rateLimit(req, "agent", 30, 60 * 60 * 1000);
    if (!llmConfigured()) throw new HttpError(503, "The AI agent is not configured (missing API key).");
    const wallet = await userWallet((await ctx.params).address);
    const user = await requireUser();
    // The user can switch the AI off on Profile & Privacy: then nothing is sent to a model.
    if (!(await prefsOf(user.id)).aiChat) throw new HttpError(403, "The AI chat is off. Turn it on in Profile & Privacy to use it.");
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "Invalid request body");
    const { message, attachment, lang, chatId } = parsed.data;
    if (!message && !attachment) throw new HttpError(400, "Send a message or a document");
    // A saved chat's history comes from the server, never from the browser.
    let chat: { id: string; title: string } | null = null;
    let history = parsed.data.history;
    if (chatId === "new") {
      chat = await createChat(user.id, wallet, message || attachment?.name || "").catch((e) => {
        throw e instanceof ChatLimitError ? new HttpError(409, e.message) : e;
      });
      history = [];
    } else if (chatId) {
      const found = await getChat(user.id, wallet, chatId);
      if (!found) throw new HttpError(404, "Chat not found");
      chat = found;
      history = historyOf(found.messages);
    }
    const asked = { kind: "user" as const, text: [message, attachment ? `📎 ${attachment.name}` : ""].filter(Boolean).join("\n"), at: new Date().toISOString() };

    // Advisory pre-scan of untrusted content, shown to the user next to the agent's answer.
    const text = attachment ? await attachmentText(attachment) : undefined;
    const flags = text ? scanForInjection(text, await readWallet(wallet)) : [];
    // Streaming (Server-Sent Events) when the client asks for it: the chat shows each tool call and
    // the reply as it is written. Plain JSON otherwise (scripts, agent-eval).
    if (req.headers.get("accept")?.includes("text/event-stream")) {
      const enc = new TextEncoder();
      const body = new ReadableStream({
        async start(controller) {
          const emit = (event: string, data: unknown) =>
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n\n`));
          if (chat) emit("chat", { id: chat.id, title: chat.title });
          if (flags.length) emit("flags", flags);
          try {
            // The browser gets each step as the chat shows it (no raw tool results).
            const { reply, steps } = await runAgent(wallet, history, message, attachment, text, lang, user.id, (e) =>
              emit(e.type, e.type === "step" ? { ...e, step: publicStep(e.step) } : e),
            );
            const shown = steps.map(publicStep);
            if (chat) await appendToChat(chat.id, [asked, { kind: "agent", text: reply, at: new Date().toISOString(), steps: shown }]);
            emit("done", { reply, steps: shown, flags });
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            if (chat) await appendToChat(chat.id, [asked, { kind: "error", text: error, at: new Date().toISOString() }]).catch(() => {});
            emit("error", { error });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
    }
    const { reply, steps } = await runAgent(wallet, history, message, attachment, text, lang, user.id);
    if (chat) await appendToChat(chat.id, [asked, { kind: "agent", text: reply, at: new Date().toISOString(), steps: steps.map(publicStep) }]);
    return Response.json({ reply, steps, flags, chatId: chat?.id });
  } catch (err) {
    return errorResponse(err);
  }
}
