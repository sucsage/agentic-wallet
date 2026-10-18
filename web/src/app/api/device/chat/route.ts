import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { getAddress } from "viem";
import { z } from "zod";

import { type AgentResume, llmConfigured, runAgent, runWithUserLlm, userLlmOf } from "@/lib/agent";
import { withTokenTally } from "@/lib/ai-usage";
import { AttachmentInput, attachmentText } from "@/lib/attachments";
import { ChatLimitError, type StoredItem, appendToChat, createChat, getChat, historyOf, publicStep } from "@/lib/chats";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";
import { scanForInjection } from "@/lib/policy";
import { prefsOf } from "@/lib/prefs";
import { readWallet } from "@/lib/state";

export const maxDuration = 300;

const ToolDef = z.object({ name: z.string().regex(/^mcp__[\w-]{1,60}$/), description: z.string().max(1200), input_schema: z.record(z.string(), z.unknown()) });

const Body = z.object({
  /** Older apps send their own history; with chatId the server's saved chat is used (the website's chats too). */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) }))
    .max(30)
    .default([]),
  message: z.string().max(4000).default(""),
  lang: z.enum(["en", "th"]).default("en"),
  attachment: AttachmentInput.optional(),
  /** A saved chat to continue, or "new" (max 5, shared with the website). */
  chatId: z.string().max(40).optional(),
  /** Bring your own key: the user's provider, model and API key, for this request only (never stored). */
  byok: z
    .object({
      provider: z.enum(["anthropic", "openrouter"]),
      apiKey: z.string().trim().min(20).max(300),
      model: z.string().trim().min(2).max(120).regex(/^[\w.:/-]+$/),
    })
    .optional(),
  /** Tools of the MCP servers the user added in the app (they run on the user's computer). */
  clientTools: z.array(ToolDef).max(64).default([]),
  /** Continue a run that paused for those tools: the sealed state and the results from the computer. */
  resume: z
    .object({
      state: z.string().max(4_000_000),
      results: z.array(z.object({ id: z.string().max(120), content: z.string().max(40_000), isError: z.boolean().optional() })).max(32),
    })
    .optional(),
});

/** What a paused run needs to continue, sealed (AES-GCM, bound to the user and wallet, 15 minutes). */
type Paused = { resume: AgentResume; asked: StoredItem | null; chatId: string | null; exp: number };
const keyOf = () => createHash("sha256").update(`aw-agent-resume\n${process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || "dev-only"}`).digest();

function seal(p: Paused, bind: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyOf(), iv);
  c.setAAD(Buffer.from(bind));
  const data = Buffer.concat([c.update(JSON.stringify(p)), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

function unseal(state: string, bind: string): Paused {
  try {
    const [iv, tag, data] = state.split(".").map((x) => Buffer.from(x, "base64url"));
    const d = createDecipheriv("aes-256-gcm", keyOf(), iv);
    d.setAAD(Buffer.from(bind));
    d.setAuthTag(tag);
    const p = JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8")) as Paused;
    if (p.exp < Date.now()) throw new Error("expired");
    return p;
  } catch {
    throw new HttpError(400, "That paused reply expired or is not valid: ask again");
  }
}

const NOTE =
  "The user is in the MilestonePay desktop app: previews you make appear in the chat and on Deals there, and the user confirms them with their device key. The app shows no forms or buttons inside your messages: when you need details, ask for them in plain text, one short list. Format replies in Markdown (short paragraphs, lists, tables when they help).";

/**
 * The AI agent from the desktop app: the same agent and tools as the website's chat, the same saved
 * chats (chatId), streaming when asked (text/event-stream), the user's own key, and the user's own
 * MCP servers: a call to one pauses the run, the app runs it on the computer, and sends the result
 * back with the sealed state to continue.
 */
export const POST = deviceRoute(
  async (device, body, req) => {
    if (!(await prefsOf(device.userId)).aiChat) throw new HttpError(403, "The AI chat is off (Profile & Privacy on the website)");
    const parsed = Body.safeParse(body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.path.includes("byok") ? "Check your own AI key and model (AI settings)" : "Invalid request");
    const { message, lang, attachment, byok, clientTools, resume } = parsed.data;
    if (!byok && !llmConfigured()) throw new HttpError(503, "The AI agent is not configured: add your own key in AI settings");
    const wallet = getAddress(device.walletAddress);
    const bind = `${device.userId}|${wallet}`;
    const paused = resume ? unseal(resume.state, bind) : null;
    if (!paused && !message && !attachment) throw new HttpError(400, "Send a message or a document");

    // The saved chat (shared with the website), or the history the app sent (older apps).
    let chatId = paused?.chatId ?? null;
    let history = parsed.data.history;
    if (!paused && parsed.data.chatId === "new") {
      chatId = (
        await createChat(device.userId, wallet, message || attachment?.name || "").catch((e) => {
          throw e instanceof ChatLimitError ? new HttpError(409, e.message) : e;
        })
      ).id;
      history = [];
    } else if (!paused && parsed.data.chatId) {
      const found = await getChat(device.userId, wallet, parsed.data.chatId);
      if (!found) throw new HttpError(404, "Chat not found");
      chatId = found.id;
      history = historyOf(found.messages);
    }
    const asked: StoredItem | null = paused ? paused.asked : { kind: "user", text: [message, attachment ? `📎 ${attachment.name}` : ""].filter(Boolean).join("\n"), at: new Date().toISOString() };
    const text = attachment ? await attachmentText(attachment) : undefined;
    const flags = text ? scanForInjection(text, await readWallet(wallet)) : [];
    const model = byok ? `${byok.provider}:${byok.model}` : null;

    const run = (onEvent?: Parameters<typeof runAgent>[7]) =>
      withTokenTally(() => {
        const go = () =>
          runAgent(wallet, history, message, attachment, text, lang, device.userId, onEvent, NOTE, {
            tools: clientTools,
            resume: paused?.resume,
            results: resume?.results,
          });
        return byok ? runWithUserLlm(userLlmOf(byok), go) : go();
      });
    /** The answer: a finished reply (saved to the chat) or a pause for the computer's tools. */
    const finish = async (r: Awaited<ReturnType<typeof run>>) => {
      const { reply, steps, pending } = r.value;
      const usage = { tokens: r.tokens, calls: r.calls };
      if (pending) return { pending: { calls: pending.calls, state: seal({ resume: pending.resume, asked, chatId, exp: Date.now() + 15 * 60_000 }, bind) }, steps: steps.map(publicStep), chatId, usage };
      const shown = steps.map(publicStep);
      if (chatId && asked) await appendToChat(chatId, [asked, { kind: "agent", text: reply, at: new Date().toISOString(), steps: shown, usage, model }]);
      return { reply, steps: shown, flags, model, chatId, usage };
    };
    const refused = (e: unknown) => {
      // A provider's refusal of the user's own key: say so without echoing anything about the key.
      const status = (e as { status?: number }).status;
      if (byok && (status === 401 || status === 403)) return new HttpError(400, `Your ${byok.provider} key was refused (check it in AI settings)`);
      if (byok && status === 404) return new HttpError(400, `${byok.provider} does not know the model "${byok.model}"`);
      if (byok && status === 429) return new HttpError(429, `Your ${byok.provider} account is out of credit or rate-limited`);
      return e;
    };

    if (req.headers.get("accept")?.includes("text/event-stream")) {
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const emit = (event: string, data: unknown) =>
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n\n`));
          if (chatId) emit("chat", { id: chatId });
          try {
            const out = await finish(await run((e) => emit(e.type, e.type === "step" ? { ...e, step: publicStep(e.step) } : e)));
            emit("pending" in out ? "pending" : "done", out);
          } catch (e) {
            const err = refused(e);
            emit("error", { error: err instanceof Error ? err.message : String(err) });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
    }
    try {
      return await finish(await run());
    } catch (e) {
      throw refused(e);
    }
  },
  { acting: true },
);
