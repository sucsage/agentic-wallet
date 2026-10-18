import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { ApiError } from "./api";
import { wallet } from "./core";
import { runMcp } from "./mcp";
import { dataDir, sessionPath } from "./paths";
import indexHtml from "./ui/index.html" with { type: "text" };
import markdownJs from "./ui/markdown.js" with { type: "text" };

/** The page with the markdown renderer inlined (one file, no extra request). */
const PAGE = (indexHtml as unknown as string).replace("/*MARKDOWN*/", () => markdownJs as unknown as string);

/**
 * Agentic Wallet desktop app. One file per OS (bun build --compile): it serves its screen on
 * 127.0.0.1 and opens it in the default browser. Only this computer can reach it, and only with the
 * token in the opened URL: other web pages cannot call it (no CORS, a custom header, Host checked).
 */
const VERSION = "0.1.0";
const PREFERRED_PORT = 47821;
const args = new Set(process.argv.slice(2));
const noOpen = args.has("--no-open");

function openBrowser(url: string) {
  if (noOpen) return;
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // No browser launcher (a server without a desktop): the URL is printed below.
  }
}

/** Already running (a second double-click): open the running one's screen and quit. */
async function alreadyRunning(): Promise<boolean> {
  if (!existsSync(sessionPath())) return false;
  try {
    const s = JSON.parse(readFileSync(sessionPath(), "utf8")) as { port: number; token: string };
    const r = await fetch(`http://127.0.0.1:${s.port}/ping`, { signal: AbortSignal.timeout(800) });
    if ((await r.json()).app !== "agentic-wallet") return false;
    const url = `http://127.0.0.1:${s.port}/#t=${s.token}`;
    console.log(`Agentic Wallet is already running: ${url}`);
    openBrowser(url);
    return true;
  } catch {
    return false;
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
  if (m === "GET" && path === "/app/deals") return json(await wallet.deals());
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
  if (m === "POST" && path === "/app/confirm-draft") return json(await wallet.confirmDraft(String((await body<{ draftId: string }>(req)).draftId ?? "")));
  if (m === "GET" && path === "/app/mcp") {
    // How to start the MCP server: this executable with --mcp (from source: bun run main.ts --mcp).
    const compiled = !/\bbun(\.exe)?$/i.test(process.execPath);
    return json({ command: process.execPath, args: compiled ? ["--mcp"] : ["run", process.argv[1], "--mcp"], calls: agentCalls });
  }
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
  if (m === "GET" && path === "/app/drafts") return json(await wallet.drafts());
  if (m === "GET" && path === "/app/activity") return json(await wallet.activity());
  if (m === "GET" && path === "/app/chat") return json({ history: wallet.chatHistory() });
  if (m === "POST" && path === "/app/chat") return json(await wallet.chat(await body(req)));
  if (m === "POST" && path === "/app/chat/clear") return (wallet.clearChat(), json({ ok: true }));
  if (m === "GET" && path === "/app/key-backup")
    return new Response(wallet.keyBackup(), {
      headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="agentic-wallet-key-backup.json"', "cache-control": "no-store" },
    });
  return json({ error: "Not found" }, 404);
}

let agentCalls = 0;

/**
 * What outside AI agents (the MCP server, `--mcp`) may do, with the agent token: read, ask the
 * wallet's AI, and queue requests. Nothing here signs or moves money: the user does that in the app.
 */
async function agentRoute(req: Request, path: string): Promise<Response> {
  agentCalls++;
  const client = (req.headers.get("x-agent-client") ?? "an AI agent").slice(0, 60);
  const m = req.method;
  if (wallet.stage() !== "ready") return json({ error: "The Agentic Wallet app is locked: ask the user to open and unlock it" }, 423);
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
    return json({ requestId: r.id, status: r.status, note: "Waiting for the user to press Sign in the Agentic Wallet app. Check with request_status." });
  }
  if (m === "GET" && path.startsWith("/agent/request/")) {
    const r = wallet.agentRequests().find((x) => x.id === decodeURIComponent(path.slice("/agent/request/".length)));
    if (!r) return json({ error: "No such request" }, 404);
    return json({ requestId: r.id, status: r.status, error: r.error, block: r.block });
  }
  return json({ error: "Not found" }, 404);
}

async function main() {
  if (process.argv.includes("--mcp")) return runMcp();
  if (await alreadyRunning()) return;
  const token = randomBytes(24).toString("base64url");
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
          "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
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
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Top-up</title><body style="font:15px system-ui;background:#0f1216;color:#e8ebef;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:420px;padding:22px;border:1px solid #272d36;border-radius:14px;background:#171b21"><h1 style="font-size:18px;margin:0 0 8px">MilestonePay</h1><p>${text.replace(/[&<>"']/g, "")}</p><p style="color:#98a1ad;font-size:13px">You can close this tab and go back to the MilestonePay app. (Test mode)</p></div></body>`,
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
  const serve = (port: number) => Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 120, fetch: (req) => handler(req, server.port!) });
  try {
    server = serve(PREFERRED_PORT);
  } catch {
    server = serve(0);
  }
  writeFileSync(sessionPath(), JSON.stringify({ port: server.port, token, agentToken, pid: process.pid }), { mode: 0o600 });
  const url = `http://127.0.0.1:${server.port}/#t=${token}`;
  console.log(`Agentic Wallet desktop ${VERSION}`);
  console.log(`Data: ${dataDir()}`);
  console.log(`Open: ${url}`);
  console.log("Keep this window open while you use the app; close it to quit.");
  openBrowser(url);
  // Background sync while unlocked.
  setInterval(() => {
    if (wallet.stage() === "ready") wallet.sync().catch(() => undefined);
  }, 20_000);
}

main();
