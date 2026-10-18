import { wallet } from "./core";
import { aiTools, callTool, resolveTool } from "./mcp-host";

/**
 * The AI chat as the app's screen sees it: one Server-Sent Events stream per message. The reply and
 * the tools it runs stream through from the server. When the AI calls a tool of one of the user's
 * MCP servers, the app runs it here, on this computer: at once for a server marked "always allow",
 * otherwise the stream ends with an "approve" event and the screen asks the user, then sends the
 * answer back (resume) to run the allowed calls and continue the reply.
 */

export type Call = { id: string; name: string; input: unknown; server?: string; tool?: string; ask?: boolean };
export type ChatInput = {
  chatId?: string | null;
  message?: string;
  lang?: "en" | "th";
  attachment?: unknown;
  /** After the user answered an "approve" event: the sealed state, the calls and which they allowed. */
  resume?: { state: string; calls: Call[]; allow: Record<string, boolean> };
};

const MAX_ROUNDS = 8;

/** Reads a text/event-stream response as { event, data } pairs. */
async function* events(res: Response): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (data) yield { event, data: JSON.parse(data) };
    }
  }
}

/** Runs the calls the user allowed (or that need no asking); a refused or failed call says so to the AI. */
async function runCalls(calls: Call[], allow: (c: Call) => boolean, emit: (e: string, d: unknown) => void) {
  const servers = wallet.mcpServers();
  const results: { id: string; content: string; isError?: boolean }[] = [];
  for (const c of calls) {
    const r = resolveTool(servers, c.name);
    if (!r) {
      results.push({ id: c.id, content: "That MCP server is no longer set up on this computer.", isError: true });
      continue;
    }
    if (!allow(c)) {
      results.push({ id: c.id, content: "The user declined this tool call.", isError: true });
      emit("mcp", { id: c.id, server: r.server, tool: r.tool, status: "declined" });
      continue;
    }
    emit("mcp", { id: c.id, server: r.server, tool: r.tool, status: "running" });
    const started = Date.now();
    try {
      const out = await callTool(r.server, r.cfg, r.tool, c.input);
      results.push({ id: c.id, content: out.text, isError: out.isError });
      emit("mcp", { id: c.id, server: r.server, tool: r.tool, status: out.isError ? "error" : "done", ms: Date.now() - started, preview: out.text.slice(0, 300) });
    } catch (e) {
      results.push({ id: c.id, content: `The tool failed: ${(e as Error).message}`, isError: true });
      emit("mcp", { id: c.id, server: r.server, tool: r.tool, status: "error", error: (e as Error).message });
    }
  }
  return results;
}

export function chatResponse(input: ChatInput): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const servers = wallet.mcpServers();
        const clientTools = await aiTools(servers).catch(() => []);
        let resume: { state: string; results: unknown[] } | undefined;
        if (input.resume) {
          const allowed = input.resume.allow;
          resume = { state: input.resume.state, results: await runCalls(input.resume.calls, (c) => allowed[c.id] === true, emit) };
        }
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const res = await wallet.chatStream({ chatId: input.chatId, message: input.message, lang: input.lang, attachment: input.attachment, clientTools, resume });
          if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            emit("error", { error: j.error ?? `The server answered ${res.status}` });
            return;
          }
          type Pending = { calls: Call[]; state: string; chatId?: string | null; usage?: unknown };
          const box: { pending: Pending | null } = { pending: null };
          for await (const ev of events(res)) {
            if (ev.event === "pending") {
              const d = ev.data as { pending: { calls: Call[]; state: string }; chatId?: string | null; usage?: unknown };
              box.pending = { ...d.pending, chatId: d.chatId, usage: d.usage };
            }
            else emit(ev.event, ev.data);
          }
          const pending = box.pending;
          if (!pending) return;
          // Which server each call is for, and whether the user wants to be asked.
          const now = wallet.mcpServers();
          const calls = pending.calls.map((c) => {
            const r = resolveTool(now, c.name);
            return { ...c, server: r?.server, tool: r?.tool, ask: r ? r.cfg.ask : true };
          });
          if (pending.usage) emit("usage", pending.usage);
          if (calls.some((c) => c.ask)) {
            emit("approve", { state: pending.state, calls, chatId: pending.chatId ?? input.chatId ?? null });
            return;
          }
          resume = { state: pending.state, results: await runCalls(calls, () => true, emit) };
        }
        emit("error", { error: "Stopped after too many tool rounds" });
      } catch (e) {
        emit("error", { error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}
