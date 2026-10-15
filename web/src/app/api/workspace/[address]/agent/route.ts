import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";

import { type Attachment, llmConfigured, runAgent } from "@/lib/agent";
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
  attachment: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("pdf"), name: z.string().max(200), base64: z.string().max(4_000_000) }),
      z.object({ kind: z.literal("text"), name: z.string().max(200), text: z.string().max(60_000) }),
    ])
    .optional(),
});

async function attachmentText(a: Attachment): Promise<string> {
  if (a.kind === "text") return a.text;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(a.base64, "base64")));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch {
    return "";
  }
}

export async function POST(req: Request, ctx: RouteContext<"/api/workspace/[address]/agent">) {
  try {
    rateLimit(req, "agent", 30, 60 * 60 * 1000);
    if (!llmConfigured()) throw new HttpError(503, "The AI agent is not configured (missing API key).");
    const wallet = await userWallet((await ctx.params).address);
    const user = await requireUser();
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "Invalid request body");
    const { history, message, attachment, lang } = parsed.data;
    if (!message && !attachment) throw new HttpError(400, "Send a message or a document");

    // Advisory pre-scan of untrusted content, shown to the user next to the agent's answer.
    const text = attachment ? await attachmentText(attachment) : undefined;
    const flags = text !== undefined ? scanForInjection(text, await readWallet(wallet)) : [];
    // Streaming (Server-Sent Events) when the client asks for it: the chat shows each tool call and
    // the reply as it is written. Plain JSON otherwise (scripts, agent-eval).
    if (req.headers.get("accept")?.includes("text/event-stream")) {
      const enc = new TextEncoder();
      const body = new ReadableStream({
        async start(controller) {
          const emit = (event: string, data: unknown) =>
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n\n`));
          if (flags.length) emit("flags", flags);
          try {
            const { reply, steps } = await runAgent(wallet, history, message, attachment, text, lang, user.id, (e) => emit(e.type, e));
            emit("done", { reply, steps, flags });
          } catch (err) {
            emit("error", { error: err instanceof Error ? err.message : String(err) });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
    }
    const { reply, steps } = await runAgent(wallet, history, message, attachment, text, lang, user.id);
    return Response.json({ reply, steps, flags });
  } catch (err) {
    return errorResponse(err);
  }
}
