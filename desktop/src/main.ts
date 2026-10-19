import { VERSION } from "./version";
import { spawn as spawnProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { ApiError } from "./api";
import { wallet } from "./core";
import { MCP_TOOLS, runMcp } from "./mcp";
import { chatResponse } from "./chat-flow";
import { type ServerEntry, parseSource, stopServer, toolsWithin } from "./mcp-host";
import { RECOMMENDED, type Suggestion, WEB_SERVER, searchRegistry } from "./web-tools";
import { APP_SERVER, installSuggestion, installed } from "./mcp-install";
import { checkUpdate, cleanOldExecutable, cleanUpdates, installUpdate, newer, prepareWindowedUpdate } from "./updater";
import { dataDir, sessionPath } from "./paths";
import indexHtml from "./ui/index.html" with { type: "text" };
import extrasJs from "./ui/extras.js" with { type: "text" };
import markdownJs from "./ui/markdown.js" with { type: "text" };
import thApp from "./ui/th-app.json" with { type: "json" };
import thWeb from "./ui/th-web.json" with { type: "json" };

/** The page with the markdown renderer inlined (one file, no extra request). */
/** Thai for the TH switch: the website's strings, then the app's own (which win). "<" escaped for the inline script. */
const TH_DICT = JSON.stringify({ ...thWeb, ...thApp }).replace(/</g, "\\u003c");
const PAGE = (indexHtml as unknown as string)
  .replace("/*MARKDOWN*/", () => markdownJs as unknown as string)
  .replace("/*EXTRAS*/", () => `window.TH_DICT = ${TH_DICT};\n${extrasJs as unknown as string}`);

/**
 * Kravii desktop app. One file per OS (bun build --compile): it serves its screen on
 * 127.0.0.1 and opens it in the default browser. Only this computer can reach it, and only with the
 * token in the opened URL: other web pages cannot call it (no CORS, a custom header, Host checked).
 */
const PREFERRED_PORT = 47821;
const args = new Set(process.argv.slice(2));
const noOpen = args.has("--no-open");

function openBrowser(url: string) {
  if (noOpen) return;
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", windowsHide: true });
  } catch {
    // No browser launcher (a server without a desktop): the URL is printed below.
  }
}

/**
 * The URL of a copy of the app already running on this computer, if any (a second double-click
 * opens its screen). An OLDER copy still running (in the tray, or a version installed elsewhere) is
 * asked to quit instead: otherwise a newly installed version would keep showing the old one.
 */
async function alreadyRunning(): Promise<string | null> {
  if (!existsSync(sessionPath())) return null;
  try {
    const s = JSON.parse(readFileSync(sessionPath(), "utf8")) as { port: number; token: string; pid?: number };
    const r = await fetch(`http://127.0.0.1:${s.port}/ping`, { signal: AbortSignal.timeout(800) });
    const ping = (await r.json()) as { app?: string; version?: string };
    if (ping.app !== "agentic-wallet") return null;
    if (ping.version && newer(VERSION, ping.version)) {
      console.log(`An older copy (${ping.version}) is running: asking it to quit`);
      await fetch(`http://127.0.0.1:${s.port}/app/quit`, { method: "POST", headers: { "x-app-token": s.token }, signal: AbortSignal.timeout(2000) }).catch(() => undefined);
      for (let i = 0; i < 40 && s.pid; i++) {
        try {
          process.kill(s.pid, 0);
        } catch {
          return null;
        }
        await Bun.sleep(250);
      }
      if (s.pid) {
        try {
          process.kill(s.pid);
        } catch {
          // gone
        }
      }
      return null;
    }
    return `http://127.0.0.1:${s.port}/#t=${s.token}`;
  } catch {
    return null;
  }
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

function fail(e: unknown) {
  if (e instanceof ApiError) return json({ error: e.message }, e.status || 502);
  console.error(e);
  return json({ error: e instanceof Error ? e.message : String(e) }, 500);
}

async function body<T>(req: Request): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}

async function route(req: Request, path: string, port: number): Promise<Response> {
  const m = req.method;
  if (m === "GET" && path === "/app/state") return json(wallet.info());
  if (m === "POST" && path === "/app/setup") return json(await wallet.setup(await body(req)));
  if (m === "POST" && path === "/app/restore") return json(await wallet.restore(await body(req)));
  if (m === "POST" && path === "/app/unlock") {
    wallet.unlock((await body<{ passphrase: string }>(req)).passphrase ?? "");
    wallet.sync().catch(() => undefined);
    return json(wallet.info());
  }
  if (m === "POST" && path === "/app/lock") return (wallet.lock(), json(wallet.info()));
  if (m === "POST" && path === "/app/select-account") return (wallet.selectAccount(String((await body<{ id: string }>(req)).id ?? "")), json(wallet.info()));
  if (m === "POST" && path === "/app/open-signup") {
    // New accounts are made on the website (sign-up, identity check, wallet); the app then signs in.
    const raw = String((await body<{ server?: string }>(req)).server ?? "") || wallet.info().defaultServer;
    let url: URL;
    try {
      url = new URL("/login", new URL(raw).origin);
    } catch {
      return json({ error: "Enter the server address, e.g. https://agentic-wallet-inky.vercel.app" }, 400);
    }
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return json({ error: "The server must use https" }, 400);
    openBrowser(url.toString());
    return json({ url: url.toString() });
  }
  if (m === "POST" && path === "/app/sync") return json(await wallet.sync());
  if (m === "GET" && path === "/app/account") return json(await wallet.account_());
  if (m === "GET" && path === "/app/deals") return json(await wallet.deals(companyParam(req)));
  if (m === "GET" && path === "/app/chain") return json(await wallet.chain());
  if (m === "POST" && path === "/app/repair") return json(await wallet.repair());
  if (m === "POST" && path === "/app/verify") return json(await wallet.verify());
  if (m === "POST" && path === "/app/move") return json(await wallet.move(await body(req)));
  if (m === "POST" && path === "/app/deliver") {
    const form = await req.formData();
    const f = form.get("file");
    const file = f instanceof File && f.size > 0 ? { name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) } : undefined;
    if (file && file.bytes.length > 4 * 1024 * 1024) return json({ error: "The file is larger than 4 MB" }, 413);
    return json(
      await wallet.deliver({
        dealId: Number(form.get("dealId")),
        index: Number(form.get("index")),
        note: String(form.get("note") ?? ""),
        file,
        carrier: String(form.get("carrier") ?? "") || undefined,
        tracking: String(form.get("tracking") ?? "") || undefined,
      }),
    );
  }
  if (m === "POST" && path === "/app/confirm-draft") {
    const b = await body<{ draftId: string; companyId?: string | null }>(req);
    return json(await wallet.confirmDraft(String(b.draftId ?? ""), b.companyId === undefined ? undefined : b.companyId || null));
  }
  if (m === "POST" && path === "/app/drafts/discard") {
    const b = await body<{ draftId: string; companyId?: string | null }>(req);
    return json(await wallet.discardDraft(String(b.draftId ?? ""), b.companyId === undefined ? undefined : b.companyId || null));
  }
  // The website's own API for this user, signed by the device (the screens that reuse the website's features).
  if (path.startsWith("/app/web/")) {
    const u = new URL(req.url);
    const company = u.searchParams.get("company");
    u.searchParams.delete("company");
    u.searchParams.delete("t");
    const bytes = m === "GET" || m === "HEAD" ? null : new Uint8Array(await req.arrayBuffer());
    const res = await wallet.web(m, `/api/${path.slice("/app/web/".length)}${u.search}`, bytes, req.headers.get("content-type"), company === null ? undefined : company || null);
    const headers = new Headers({ "cache-control": "no-store" });
    for (const h of ["content-type", "content-disposition", "x-preview-pages"]) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(res.body, { status: res.status, headers });
  }
  if (m === "GET" && path === "/app/update") return json(await checkUpdate(new URL(req.url).searchParams.has("force")));
  if (m === "POST" && path === "/app/update") {
    // The windowed app: the new version is downloaded, checked and ready; then this app quits and the
    // new one opens by itself (a new window).
    if (process.env.AW_SHELL === "electrobun") {
      const { version, finish } = await prepareWindowedUpdate();
      setTimeout(finish, 400);
      return json({ ok: true, version, reopen: true });
    }
    const version = await installUpdate();
    restartSoon();
    return json({ ok: true, version });
  }
  if (m === "POST" && path === "/app/quit") {
    setTimeout(() => process.exit(0), 300);
    return json({ ok: true });
  }
  if (m === "GET" && path === "/app/mcp") return json(mcpView());
  if (m === "POST" && path === "/app/mcp/settings") return (wallet.setMcpSettings(await body(req)), json(mcpView()));
  if (m === "POST" && path === "/app/mcp/log/clear") return (wallet.clearMcpLog(), json(mcpView()));
  if (m === "POST" && path === "/app/agent-requests") {
    const b = await body<{ id: string; sign: boolean }>(req);
    return json(await wallet.decideAgentRequest(String(b.id ?? ""), b.sign === true));
  }
  if (m === "GET" && path === "/app/ai") return json({ ...wallet.aiSettings(), ...(await wallet.instructions()), usage: await wallet.aiUsage().catch(() => null) });
  if (m === "POST" && path === "/app/ai/key") return json(wallet.setByok(await body(req)));
  if (m === "POST" && path === "/app/ai/key/remove") return json(wallet.setByok(null));
  if (m === "POST" && path === "/app/ai/instructions") return json(await wallet.setInstructions((await body<{ text: string }>(req)).text));
  if (m === "GET" && path === "/app/onboarding") return json(await wallet.setupStatus());
  if (m === "POST" && path === "/app/kyc-start") {
    const r = await wallet.kycStart((await body<{ country?: string }>(req)).country === "CN" ? "CN" : "TH");
    openBrowser(r.url);
    return json(r);
  }
  if (m === "POST" && path === "/app/setup-finish") return json(await wallet.finishSetup());
  if (m === "GET" && path === "/app/friends") return json(await wallet.friends());
  if (m === "POST" && path === "/app/friends") return json(await wallet.friendAction(await body(req)));
  if (m === "GET" && path === "/app/topup") return json(await wallet.topupInfo());
  if (m === "POST" && path === "/app/topup") {
    const b = await body<{ amount: number; method: string }>(req);
    const r = await wallet.topupStart({ amount: Number(b.amount), method: b.method, returnTo: `http://127.0.0.1:${port}/topup-done` });
    if (r.url) openBrowser(r.url);
    return json(r);
  }
  if (m === "POST" && path === "/app/counter-pay") return json(await wallet.counterPay(String((await body<{ slip: string }>(req)).slip ?? "")));
  if (m === "POST" && path === "/app/due") return json(await wallet.due(await body(req)));
  if (m === "GET" && path === "/app/invite-links") return json(await wallet.inviteLinks());
  if (m === "POST" && path === "/app/invite-links") return json(await wallet.inviteLinkAction(await body(req)));
  if (m === "GET" && path === "/app/groups") return json(await wallet.groups());
  if (m === "POST" && path === "/app/groups") return json(await wallet.groupAction(await body(req)));
  if (m === "POST" && path === "/app/vote") {
    const b = await body<{ proposalId: string; approve: boolean }>(req);
    return json(await wallet.vote(String(b.proposalId ?? ""), b.approve === true));
  }
  if (m === "GET" && path === "/app/contacts") return json(await wallet.contacts());
  if (m === "POST" && path === "/app/payee") {
    const b = await body<{ friendshipId: string; allowed: boolean }>(req);
    return json(await wallet.payee(String(b.friendshipId ?? ""), b.allowed === true));
  }
  if (m === "GET" && path === "/app/drafts") return json(await wallet.drafts(companyParam(req)));
  if (m === "GET" && path === "/app/activity") return json(await wallet.activity());
  if (m === "POST" && path === "/app/changes") return json(await wallet.askChanges(await body(req)));
  if (m === "GET" && path === "/app/preview") {
    const q = new URL(req.url).searchParams;
    const { jpeg, pages } = await wallet.preview(Number(q.get("deal")), Number(q.get("index")), Number(q.get("page") ?? 1));
    return new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg", "cache-control": "no-store", "x-preview-pages": String(pages) } });
  }
  if (m === "POST" && path === "/app/acting") return json(await wallet.setActing((await body<{ groupId: string | null }>(req)).groupId ?? null));
  // The AI chat: saved chats on the server (shared with the website), replies streamed, the user's MCP tools run here.
  if (m === "GET" && path === "/app/chats") return json(await wallet.chatList());
  if (m === "GET" && path === "/app/chat") return json(await wallet.chatHistory(String(new URL(req.url).searchParams.get("id") ?? "")));
  if (m === "POST" && path === "/app/chat") return chatResponse(await body(req));
  if (m === "POST" && path === "/app/chat/delete") return json(await wallet.deleteChat(String((await body<{ id: string }>(req)).id ?? "")));
  // MCP servers for Kravii's AI (the app is their client).
  if (m === "GET" && path === "/app/mcp/servers") return json(await mcpServersView());
  if (m === "POST" && path === "/app/mcp/servers/add") {
    const b = await body<{ source: string; name?: string }>(req);
    const found = parseSource(String(b.source ?? ""), b.name ? String(b.name) : undefined);
    const list = wallet.mcpServers();
    // "web" is the app's own web tools (mcp__web__…).
    for (const [name, entry] of Object.entries(found)) list[name === WEB_SERVER ? "web_2" : name === APP_SERVER ? "kravii_2" : name] = { ...entry, enabled: true, ask: true };
    wallet.saveMcpServers(list);
    return json(await mcpServersView());
  }
  if (m === "POST" && path === "/app/mcp/servers/update") {
    const b = await body<{ name: string; enabled?: boolean; ask?: boolean; entry?: string }>(req);
    const list = wallet.mcpServers();
    const cur = list[String(b.name)];
    if (!cur) return json({ error: "No such server" }, 404);
    if (typeof b.enabled === "boolean") cur.enabled = b.enabled;
    if (typeof b.ask === "boolean") cur.ask = b.ask;
    if (typeof b.entry === "string") {
      const e = JSON.parse(b.entry) as ServerEntry;
      // The page shows saved values as •••: keep those as they were.
      for (const k of ["env", "headers"] as const) {
        const v = e[k];
        if (v) for (const [n, x] of Object.entries(v)) if (x === "•••") v[n] = cur[k]?.[n] ?? "";
      }
      list[String(b.name)] = { ...e, enabled: cur.enabled, ask: cur.ask, source: cur.source };
    }
    stopServer(String(b.name));
    wallet.saveMcpServers(list);
    return json(await mcpServersView());
  }
  // Finding servers: the recommended ones and a search of the official MCP Registry; one click adds one.
  if (m === "GET" && path === "/app/mcp/suggest") {
    const q = String(new URL(req.url).searchParams.get("q") ?? "");
    const mark = (s: Suggestion) => ({ ...s, installed: installed(s) });
    return json({ recommended: RECOMMENDED.map(mark), results: q ? (await searchRegistry(q)).map(mark) : [] });
  }
  if (m === "POST" && path === "/app/mcp/servers/install") {
    const b = await body<{ id?: string; suggestion?: Suggestion }>(req);
    const s = RECOMMENDED.find((x) => x.id === b.id) ?? b.suggestion;
    if (!s || !s.entry) return json({ error: "Choose a server" }, 400);
    try {
      installSuggestion(s);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
    return json(await mcpServersView());
  }
  if (m === "POST" && path === "/app/window") {
    const op = String((await body<{ op: string }>(req)).op ?? "");
    if (!windowControl || !["minimize", "maximize", "close"].includes(op)) return json({ error: "No window to control" }, 400);
    windowControl(op as "minimize" | "maximize" | "close");
    return json({ ok: true });
  }
  if (m === "GET" && path === "/app/web-tools") return json(wallet.webTools());
  if (m === "POST" && path === "/app/web-tools") return json(wallet.setWebTools(await body(req)));
  if (m === "POST" && path === "/app/mcp/servers/remove") {
    const name = String((await body<{ name: string }>(req)).name ?? "");
    const list = wallet.mcpServers();
    delete list[name];
    stopServer(name);
    wallet.saveMcpServers(list);
    return json(await mcpServersView());
  }
  if (m === "GET" && path === "/app/key-backup")
    return new Response(wallet.keyBackup(), {
      headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="kravii-key-backup.json"', "cache-control": "no-store" },
    });
  return json({ error: "Not found" }, 404);
}

let agentCalls = 0;

/** How to start the MCP server: this executable with --mcp (from source: bun run main.ts --mcp). */
function mcpEntry() {
  // The windowed build (Electrobun): its own Bun runs the app's bundled entry with --mcp.
  if (process.env.AW_SHELL === "electrobun" && process.env.AW_ENTRY) return { command: process.execPath, args: [process.env.AW_ENTRY, "--mcp"] };
  const compiled = !/\bbun(\.exe)?$/i.test(process.execPath);
  return { command: process.execPath, args: compiled ? ["--mcp"] : ["run", process.argv[1], "--mcp"] };
}

/** The user's MCP servers with their status and tools (starting the enabled ones). */

async function mcpServersView() {
  const list = wallet.mcpServers();
  const servers = await Promise.all(
    Object.entries(list).map(async ([name, cfg]) => {
      // A server still starting (e.g. downloading its package) shows as starting instead of holding the page.
      const status = cfg.enabled ? await toolsWithin(name, cfg, 8000) : { tools: [], error: null, log: "" };
      const mask = (v?: Record<string, string>) => (v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x ? "•••" : ""])) : undefined);
      return { name, ...cfg, env: mask(cfg.env), headers: mask(cfg.headers), tools: status.tools.map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 200) })), error: status.error, log: status.log };
    }),
  );
  return { servers };
}

/** The MCP server page: switches, the clients it can set up, the tools and the latest calls. */
function mcpView() {
  const entry = mcpEntry();
  return { ...entry, calls: agentCalls, settings: wallet.mcpSettings(), tools: MCP_TOOLS, log: wallet.mcpLog().slice(-100).reverse() };
}

/**
 * What outside AI agents (the MCP server, `--mcp`) may do, with the agent token: read, ask the
 * wallet's AI, and queue requests. Nothing here signs or moves money: the user does that in the app.
 */
/** Which MCP tool an agent path is, and which of the user's switches (MCP server page) allows it. */
function agentTool(m: string, path: string): { tool: string; group: "read" | "ask" | "request" } {
  if (m === "GET" && path === "/agent/status") return { tool: "wallet_status", group: "read" };
  if (m === "GET" && path === "/agent/deals") return { tool: "list_deals", group: "read" };
  if (m === "GET" && path === "/agent/activity") return { tool: "list_activity", group: "read" };
  if (m === "GET" && path === "/agent/friends") return { tool: "list_friends", group: "read" };
  if (m === "GET" && path === "/agent/drafts") return { tool: "list_drafts", group: "read" };
  if (m === "POST" && path === "/agent/ask") return { tool: "ask_wallet_ai", group: "ask" };
  if (m === "GET" && path.startsWith("/agent/request/")) return { tool: "request_status", group: "request" };
  return { tool: "request", group: "request" };
}

/** Every agent call is checked against the user's switches and written to the log they see. */
async function agentRoute(req: Request, path: string): Promise<Response> {
  agentCalls++;
  const client = (req.headers.get("x-agent-client") ?? "an AI agent").slice(0, 60);
  if (wallet.stage() !== "ready") return json({ error: "The Kravii app is locked: ask the user to open and unlock it" }, 423);
  const { tool, group } = agentTool(req.method, path);
  const named = req.method === "POST" && path === "/agent/request" ? `request_${String((await req.clone().json().catch(() => ({})) as { kind?: unknown }).kind ?? "?").slice(0, 20)}` : tool;
  const settings = wallet.mcpSettings();
  const started = Date.now();
  let res: Response;
  if (!settings.enabled) res = json({ error: "The user turned the MCP server off in the Kravii app" }, 403);
  else if (!settings[group]) res = json({ error: `The user does not allow ${group === "read" ? "reading the wallet" : group === "ask" ? "asking the wallet's AI" : "requests for their signature"} (MCP server page in the app)` }, 403);
  else res = await agentAnswer(req, path, client).catch(fail);
  const out = (await res.clone().json().catch(() => ({}))) as { error?: string; tokens?: number };
  try {
    wallet.logMcpCall({ at: started, client, tool: named, ok: res.ok, ms: Date.now() - started, tokens: out.tokens || undefined, error: res.ok ? undefined : String(out.error ?? res.status).slice(0, 160) });
  } catch {
    // locked meanwhile: no log
  }
  return res;
}

async function agentAnswer(req: Request, path: string, client: string): Promise<Response> {
  const m = req.method;
  if (m === "GET" && path === "/agent/status") {
    const a = await wallet.account_();
    const info = wallet.info();
    return json({ name: a.name, balance: a.balance, currency: a.currency, chainHeight: info.height, waitingForSignature: (info.agentRequests ?? []).length + info.requests.length, mode: "test (Mock Bank money)" });
  }
  if (m === "GET" && path === "/agent/deals") return json(await wallet.deals());
  if (m === "GET" && path === "/agent/activity") return json(await wallet.activity());
  if (m === "GET" && path === "/agent/friends") return json(await wallet.friends());
  if (m === "GET" && path === "/agent/drafts") return json(await wallet.drafts());
  if (m === "POST" && path === "/agent/ask") {
    const b = await body<{ message?: string; lang?: string }>(req);
    if (!b.message?.trim()) return json({ error: "Send a message" }, 400);
    return json(await wallet.agentAsk(client, b.message, b.lang === "th" ? "th" : "en"));
  }
  if (m === "POST" && path === "/agent/request") {
    const r = wallet.addAgentRequest(client, await body(req));
    return json({ requestId: r.id, status: r.status, note: "Waiting for the user to press Sign in the Kravii app. Check with request_status." });
  }
  if (m === "GET" && path.startsWith("/agent/request/")) {
    const r = wallet.agentRequests().find((x) => x.id === decodeURIComponent(path.slice("/agent/request/".length)));
    if (!r) return json({ error: "No such request" }, 404);
    return json({ requestId: r.id, status: r.status, error: r.error, block: r.block });
  }
  return json({ error: "Not found" }, 404);
}

/** ?company=<id> asks for a group's view (the server checks membership); without it the view follows "Acting as". */
function companyParam(req: Request): string | undefined {
  const c = new URL(req.url).searchParams.get("company");
  return c ? c.slice(0, 40) : undefined;
}

/** Restarts this executable (after an update) with the same arguments; the new process takes over the port and the open tab. */
function restartSoon() {
  const args = [...process.argv.slice(2).filter((a) => a !== "--restarted"), "--restarted"];
  setTimeout(() => {
    const child = spawnProcess(process.execPath, args, { detached: true, stdio: "ignore", env: process.env });
    child.unref();
    process.exit(0);
  }, 400);
}

/** After an update: wait for the old process to leave, then reuse its port and token (the open tab keeps working). */
async function takeOver(): Promise<{ port: number; token: string } | null> {
  try {
    const s = JSON.parse(readFileSync(sessionPath(), "utf8")) as { port: number; token: string; pid: number };
    for (let i = 0; i < 60; i++) {
      try {
        process.kill(s.pid, 0);
      } catch {
        return { port: s.port, token: s.token };
      }
      await Bun.sleep(250);
    }
  } catch {
    // no session: start fresh
  }
  return null;
}

/** The command line: the MCP server (--mcp), or the app opened in the default browser. */
async function main() {
  if (process.argv.includes("--mcp")) return runMcp();
  await startApp({ browser: !noOpen });
}

/**
 * Starts the app's local server (or finds the copy already running) and returns its URL. The
 * command-line build opens it in the browser; the windowed build (desktop/electrobun) shows it in
 * its own window.
 */
export async function startApp(opts: { browser: boolean }): Promise<{ url: string; already: boolean }> {
  const restarted = process.argv.includes("--restarted");
  const previous = restarted ? await takeOver() : null;
  if (!restarted) {
    const running = await alreadyRunning();
    if (running) {
      console.log(`Kravii is already running: ${running}`);
      if (opts.browser) openBrowser(running);
      return { url: running, already: true };
    }
  }
  cleanOldExecutable();
  cleanUpdates();
  const token = previous?.token ?? randomBytes(24).toString("base64url");
  // A second, weaker token for MCP agents (read and queue only), kept in the same private file.
  const agentToken = randomBytes(24).toString("base64url");
  const handler = async (req: Request, port: number) => {
    const url = new URL(req.url);
    // DNS rebinding: only our own host name.
    const host = req.headers.get("host");
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return new Response("Forbidden", { status: 403 });
    if (url.pathname === "/ping") return json({ app: "agentic-wallet", version: VERSION });
    if (url.pathname === "/" && req.method === "GET")
      return new Response(PAGE, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
        },
      });
    if (url.pathname === "/topup-done" && req.method === "GET") {
      // The browser back from Stripe Checkout (no app token here): credit a paid session of this user.
      const session = url.searchParams.get("session");
      let text = "Top-up cancelled.";
      if (session && wallet.stage() === "ready") {
        try {
          const r = await wallet.topupConfirm(session);
          text = r.status === "paid" ? `Top-up done: ${r.amount.toLocaleString()} ${r.currency} added to your wallet.` : `Payment ${r.status}: it is added when it clears.`;
        } catch (e) {
          text = e instanceof Error ? e.message : String(e);
        }
      } else if (session) text = "Unlock the app, then the top-up is added on its next check.";
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Top-up</title><body style="font:15px system-ui;background:#0f1216;color:#e8ebef;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:420px;padding:22px;border:1px solid #272d36;border-radius:14px;background:#171b21"><h1 style="font-size:18px;margin:0 0 8px">Kravii</h1><p>${text.replace(/[&<>"']/g, "")}</p><p style="color:#98a1ad;font-size:13px">You can close this tab and go back to the Kravii app. (Test mode)</p></div></body>`,
        { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } },
      );
    }
    if (url.pathname.startsWith("/agent/")) {
      if (req.headers.get("x-agent-token") !== agentToken) return json({ error: "Agent token missing" }, 401);
      try {
        return await agentRoute(req, url.pathname);
      } catch (e) {
        return fail(e);
      }
    }
    if (url.pathname.startsWith("/app/")) {
      const given = req.headers.get("x-app-token") ?? url.searchParams.get("t");
      if (given !== token) return json({ error: "Open the app from the link it printed (the token is missing)" }, 401);
      try {
        return await route(req, url.pathname, port);
      } catch (e) {
        return fail(e);
      }
    }
    return new Response("Not found", { status: 404 });
  };
  let server: ReturnType<typeof Bun.serve>;
  const serve = (port: number) => Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 240, fetch: (req) => handler(req, server.port!) });
  try {
    server = serve(previous?.port ?? PREFERRED_PORT);
  } catch {
    server = serve(0);
  }
  writeFileSync(sessionPath(), JSON.stringify({ port: server.port, token, agentToken, pid: process.pid }), { mode: 0o600 });
  const url = `http://127.0.0.1:${server.port}/#t=${token}`;
  console.log(`Kravii desktop ${VERSION}`);
  console.log(`Data: ${dataDir()}`);
  console.log(`Open: ${url}`);
  console.log("Keep this window open while you use the app; close it to quit.");
  // Restarted after an update on the same port and token: the tab already open reconnects by itself.
  if (opts.browser && (!previous || previous.port !== server.port)) openBrowser(url);
  // Background sync while unlocked.
  setInterval(() => {
    if (wallet.stage() === "ready") wallet.backgroundSync();
  }, 20_000);
  return { url, already: false };
}

export { runMcp };

/** The windowed build's controls for the page's own title bar (minimize, maximize, close). */
let windowControl: ((op: "minimize" | "maximize" | "close") => void) | null = null;
export function setWindowControl(fn: typeof windowControl) {
  windowControl = fn;
}

// Run as the program (the compiled app, or `bun run src/main.ts`); imported by the windowed build it waits to be started.
if (import.meta.main) main();
