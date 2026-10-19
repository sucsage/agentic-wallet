import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { dataDir } from "./paths";

/**
 * MCP servers the user adds for Kravii's own AI (the app is the MCP client here). Same entry
 * shape as other MCP clients' config ("mcpServers": { name: { command, args, env } } or { url }), so
 * a config copied from a server's README works as is. Sources:
 *   - a GitHub link or an npm package: run with the app's built-in Bun (`bun x`), no Node needed;
 *   - pasted server code (JavaScript/TypeScript): saved under the app's data folder and run with Bun;
 *   - a JSON config, or the URL of a remote (streamable HTTP) MCP server.
 * The AI sees each tool as mcp__<server>__<tool>; the app runs the call here, on this computer, after
 * the user allows it (each time, unless the server is marked "always allow").
 */

export type ServerEntry = { command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };
export type ServerConfig = ServerEntry & { enabled: boolean; ask: boolean; source?: string };
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };

const PROTOCOL = "2025-06-18";
const CALL_TIMEOUT = 60_000;

/** The app's own executable acting as Bun (BUN_BE_BUN=1), or bun when running from source. */
function bunCommand(): { command: string; env: Record<string, string> } {
  const compiled = !/\bbun(\.exe)?$/i.test(process.execPath);
  return { command: process.execPath, env: compiled ? { BUN_BE_BUN: "1" } : {} };
}

/**
 * `bun x <package>` run directly: the package is installed once under the app's data folder and its
 * program is started with the app's own Bun. `bun x` itself starts the program as a second process,
 * and on Windows that one opened a console window (a flash on every start). Null: not a plain
 * `bun x <package>` entry, or the package has no program; then `bun x` is used as before.
 */
async function directBunX(args: string[], bun: { command: string; env: Record<string, string> }): Promise<string[] | null> {
  const spec = String(args[1] ?? "");
  if (args[0] !== "x" || !/^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(spec)) return null;
  const name = spec.replace(/(.)@[^@/]*$/, "$1");
  const dir = join(dataDir(), "mcp-packages", spec.replace(/[^\w.@-]/g, "_"));
  const pkgFile = join(dir, "node_modules", ...name.split("/"), "package.json");
  if (!existsSync(pkgFile)) {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, "package.json"))) writeFileSync(join(dir, "package.json"), '{ "name": "kravii-mcp-server", "private": true }\n');
    const add = Bun.spawn([bun.command, "add", spec], { cwd: dir, stdin: "ignore", stdout: "ignore", stderr: "ignore", env: { ...process.env, ...bun.env }, windowsHide: true });
    const timer = setTimeout(() => add.kill(), 180_000);
    await add.exited.finally(() => clearTimeout(timer));
    if (!existsSync(pkgFile)) return null;
  }
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { bin?: string | Record<string, string> };
  const bins = typeof pkg.bin === "string" ? { [name.replace(/^@[^/]+\//, "")]: pkg.bin } : (pkg.bin ?? {});
  const bin = bins[name.replace(/^@[^/]+\//, "")] ?? Object.values(bins)[0];
  if (!bin) return null;
  return [join(dirname(pkgFile), bin), ...args.slice(2)];
}

export const safeName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "server";

/**
 * Turns what the user pasted into server entries: a JSON config ({"mcpServers": …}, one entry, or a
 * map of entries), a GitHub link, an npm package name, an http(s) MCP URL, or server code.
 */
export function parseSource(input: string, nameHint?: string): Record<string, ServerEntry & { source: string }> {
  const text = input.trim();
  if (!text) throw new Error("Paste a GitHub link, an npm package, a URL, a JSON config or server code");
  if (text.startsWith("{")) {
    let j: unknown;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error("That JSON does not parse");
    }
    const obj = j as Record<string, unknown>;
    const map = (obj.mcpServers ?? obj.servers ?? (("command" in obj || "url" in obj) ? { [nameHint || "server"]: obj } : obj)) as Record<string, ServerEntry>;
    const out: Record<string, ServerEntry & { source: string }> = {};
    for (const [name, e] of Object.entries(map)) {
      if (!e || typeof e !== "object") continue;
      if (typeof e.url === "string") out[safeName(name)] = { url: e.url, headers: e.headers, source: "config" };
      else if (typeof e.command === "string") out[safeName(name)] = { command: e.command, args: Array.isArray(e.args) ? e.args.map(String) : [], env: e.env, source: "config" };
    }
    if (!Object.keys(out).length) throw new Error("No server entry with a command or a url in that JSON");
    return out;
  }
  const gh = text.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/);
  if (gh) return { [safeName(nameHint || gh[2])]: { command: "bun", args: ["x", `github:${gh[1]}/${gh[2]}`], source: text } };
  if (/^https?:\/\//.test(text)) return { [safeName(nameHint || new URL(text).hostname.split(".")[0])]: { url: text, source: text } };
  if (/^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(text)) return { [safeName(nameHint || text.replace(/^@[\w.-]+\//, "").replace(/@.*$/, ""))]: { command: "bun", args: ["x", text], source: text } };
  // Anything else is server code: saved as a file the app runs with its own Bun.
  const name = safeName(nameHint || "custom");
  const dir = join(dataDir(), "mcp-servers", name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, /^\s*import .* from |:\s*(string|number)\b|interface /m.test(text) ? "server.ts" : "server.js");
  writeFileSync(file, text);
  return { [name]: { command: "bun", args: ["run", file], source: "code" } };
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/** One running server (stdio child process or remote HTTP endpoint) speaking JSON-RPC 2.0. */
class Connection {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private session: string | null = null;
  stderr = "";
  tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] = [];
  ready: Promise<void> | null = null;

  constructor(
    readonly name: string,
    readonly entry: ServerEntry,
  ) {}

  /**
   * When the last start failed or the server stopped by itself: it is tried again after 10 minutes
   * (or when restarted on the MCP page), not on every message.
   */
  private failedAt = 0;
  private stoppedOnPurpose = false;

  start(): Promise<void> {
    if (this.ready && this.failedAt && Date.now() - this.failedAt > 600_000) {
      this.ready = null;
      this.failedAt = 0;
    }
    if (this.ready) return this.ready;
    this.ready = (async () => {
      if (!this.entry.url) await this.spawn();
      await this.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "Kravii Wallet", version: "1" } });
      await this.notify("notifications/initialized", {});
      const r = (await this.request("tools/list", {})) as { tools?: Connection["tools"] };
      this.tools = Array.isArray(r?.tools) ? r.tools.slice(0, 64) : [];
    })().catch((e) => {
      this.failedAt = Date.now();
      this.stop();
      throw e;
    });
    return this.ready;
  }

  private async spawn() {
    let { command, args = [], env = {} } = this.entry;
    let extra: Record<string, string> = {};
    // "bun" / "bunx" run on the app's own Bun; "bunx x" is the same as "bun x".
    if (command === "bun" || command === "bunx") {
      const b = bunCommand();
      if (command === "bunx") args = ["x", ...args];
      command = b.command;
      extra = b.env;
      args = (await directBunX(args, b).catch(() => null)) ?? args;
    }
    this.proc = Bun.spawn([command!, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...extra, ...env },
      // Windows: no console window for the server (the app itself has none).
      windowsHide: true,
    });
    const dec = new TextDecoder();
    (async () => {
      const reader = (this.proc!.stdout as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        this.buffer += dec.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, nl).trim();
          this.buffer = this.buffer.slice(nl + 1);
          if (line) this.onMessage(line);
        }
      }
      const err = new Error(`The server stopped${this.stderr ? `: ${this.stderr.trim().split("\n").slice(-2).join(" ")}` : ""}`);
      this.fail(err);
      // Stopped by itself: not started again on every message (each start is a new process).
      if (!this.stoppedOnPurpose) {
        this.failedAt = Date.now();
        this.ready = Promise.reject(err);
        this.ready.catch(() => undefined);
      }
    })().catch(() => undefined);
    (async () => {
      const reader = (this.proc!.stderr as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.stderr = (this.stderr + dec.decode(value)).slice(-4000);
      }
    })().catch(() => undefined);
  }

  private onMessage(line: string) {
    let m: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof m.id !== "number") return;
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error) p.reject(new Error(m.error.message ?? "The MCP server returned an error"));
    else p.resolve(m.result);
  }

  private fail(e: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
    this.ready = null;
    this.proc = null;
  }

  private async notify(method: string, params: unknown) {
    const msg = { jsonrpc: "2.0", method, params };
    if (this.entry.url) await this.http(msg).catch(() => undefined);
    else this.write(msg);
  }

  private write(msg: unknown) {
    const sink = this.proc?.stdin as { write: (s: string) => void; flush?: () => void } | undefined;
    if (!sink) throw new Error("The server is not running");
    sink.write(`${JSON.stringify(msg)}\n`);
    sink.flush?.();
  }

  private async http(msg: { id?: number; method: string; params: unknown }): Promise<unknown> {
    const res = await fetch(this.entry.url!, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(this.session ? { "mcp-session-id": this.session } : {}), ...(this.entry.headers ?? {}) },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(CALL_TIMEOUT),
    });
    this.session = res.headers.get("mcp-session-id") ?? this.session;
    if (msg.id === undefined) return null;
    if (!res.ok) throw new Error(`The MCP server answered ${res.status}`);
    const text = await res.text();
    // Either plain JSON or a server-sent event stream carrying the JSON-RPC answer.
    const payload = (res.headers.get("content-type") ?? "").includes("text/event-stream")
      ? text
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .reverse()
          .find((d) => d.includes(`"id":${msg.id}`) || d.includes(`"id": ${msg.id}`))
      : text;
    const m = JSON.parse(payload ?? "{}") as { result?: unknown; error?: { message?: string } };
    if (m.error) throw new Error(m.error.message ?? "The MCP server returned an error");
    return m.result;
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    if (this.entry.url) return this.http(msg);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} did not answer within ${CALL_TIMEOUT / 1000} s`));
      }, CALL_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write(msg);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  stop() {
    this.stoppedOnPurpose = true;
    try {
      this.proc?.kill();
    } catch {
      // already gone
    }
    this.fail(new Error("Stopped"));
  }
}

const connections = new Map<string, Connection>();
const key = (name: string, e: ServerEntry) => `${name}:${JSON.stringify(e)}`;

function connection(name: string, entry: ServerEntry): Connection {
  const k = key(name, entry);
  let c = connections.get(k);
  if (!c) {
    for (const [other, conn] of connections) if (other.startsWith(`${name}:`)) (conn.stop(), connections.delete(other));
    c = new Connection(name, entry);
    connections.set(k, c);
  }
  return c;
}

/** Starts (if needed) and lists a server's tools; the error text when it cannot start. */
export async function serverTools(name: string, entry: ServerEntry): Promise<{ tools: Connection["tools"]; error: string | null; log: string }> {
  const c = connection(name, entry);
  try {
    await c.start();
    return { tools: c.tools, error: null, log: c.stderr.slice(-800) };
  } catch (e) {
    return { tools: [], error: (e as Error).message, log: c.stderr.slice(-800) };
  }
}

/** A server's tools if it is ready within `ms` (it keeps starting in the background), else none for now. */
export async function toolsWithin(name: string, entry: ServerEntry, ms: number): Promise<{ tools: Connection["tools"]; error: string | null; log: string; starting?: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ tools: Connection["tools"]; error: string | null; log: string; starting: boolean }>((resolve) => {
    timer = setTimeout(() => resolve({ tools: [], error: null, log: "", starting: true }), ms);
  });
  try {
    return await Promise.race([serverTools(name, entry), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The tools of every enabled server, named for the AI (mcp__server__tool). Servers start in parallel;
 * one that is not ready within a few seconds (downloading, broken) is left out of this message
 * instead of holding the chat.
 */
export async function aiTools(servers: Record<string, ServerConfig>): Promise<ToolDef[]> {
  const out: ToolDef[] = [];
  const on = Object.entries(servers).filter(([, cfg]) => cfg.enabled);
  const ready = await Promise.all(on.map(([name, cfg]) => toolsWithin(name, cfg, 6000)));
  for (const [i, [name]] of on.entries()) {
    const { tools } = ready[i];
    for (const t of tools) {
      const full = `mcp__${safeName(name)}__${t.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 64);
      out.push({ name: full, description: `[MCP server "${name}" on the user's computer] ${(t.description ?? "").slice(0, 900)}`, input_schema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} } });
    }
  }
  return out.slice(0, 64);
}

/** Which server and tool an AI tool name points at. */
export function resolveTool(servers: Record<string, ServerConfig>, full: string): { server: string; tool: string; cfg: ServerConfig } | null {
  const m = full.match(/^mcp__([a-zA-Z0-9_-]+?)__(.+)$/);
  if (!m) return null;
  const name = Object.keys(servers).find((n) => safeName(n) === m[1]);
  if (!name) return null;
  const cfg = servers[name];
  const conn = connection(name, cfg);
  const tool = conn.tools.find((t) => t.name.replace(/[^a-zA-Z0-9_-]/g, "_") === m[2])?.name ?? m[2];
  return { server: name, tool, cfg };
}

/** Runs one tool call; the result as text for the AI. */
export async function callTool(server: string, cfg: ServerEntry, tool: string, args: unknown): Promise<{ text: string; isError: boolean }> {
  const c = connection(server, cfg);
  await c.start();
  const r = (await c.request("tools/call", { name: tool, arguments: args ?? {} })) as { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
  const text =
    (r?.content ?? [])
      .map((b) => (b.type === "text" ? (b.text ?? "") : `[${b.type} content]`))
      .join("\n")
      .trim() || (r?.structuredContent ? JSON.stringify(r.structuredContent) : "(no output)");
  return { text: text.slice(0, 20_000), isError: Boolean(r?.isError) };
}

export function stopServer(name: string) {
  for (const [k, c] of connections) if (k.startsWith(`${name}:`)) (c.stop(), connections.delete(k));
}

export function stopAll() {
  for (const c of connections.values()) c.stop();
  connections.clear();
}

export const codeFileExists = (path: string) => existsSync(path);
