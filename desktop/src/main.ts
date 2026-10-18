import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { ApiError } from "./api";
import { wallet } from "./core";
import { dataDir, sessionPath } from "./paths";
import indexHtml from "./ui/index.html" with { type: "text" };

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

async function route(req: Request, path: string): Promise<Response> {
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
  if (m === "POST" && path === "/app/sync") return json(await wallet.sync());
  if (m === "GET" && path === "/app/account") return json(await wallet.account_());
  if (m === "GET" && path === "/app/deals") return json(await wallet.deals());
  if (m === "GET" && path === "/app/chain") return json(await wallet.chain());
  if (m === "POST" && path === "/app/repair") return json(await wallet.repair());
  if (m === "POST" && path === "/app/verify") return json(await wallet.verify());
  if (m === "POST" && path === "/app/move") return json(await wallet.move(await body(req)));
  if (m === "GET" && path === "/app/key-backup")
    return new Response(wallet.keyBackup(), {
      headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="agentic-wallet-key-backup.json"', "cache-control": "no-store" },
    });
  return json({ error: "Not found" }, 404);
}

async function main() {
  if (await alreadyRunning()) return;
  const token = randomBytes(24).toString("base64url");
  const handler = async (req: Request, port: number) => {
    const url = new URL(req.url);
    // DNS rebinding: only our own host name.
    const host = req.headers.get("host");
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return new Response("Forbidden", { status: 403 });
    if (url.pathname === "/ping") return json({ app: "agentic-wallet", version: VERSION });
    if (url.pathname === "/" && req.method === "GET")
      return new Response(indexHtml as unknown as string, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
        },
      });
    if (url.pathname.startsWith("/app/")) {
      const given = req.headers.get("x-app-token") ?? url.searchParams.get("t");
      if (given !== token) return json({ error: "Open the app from the link it printed (the token is missing)" }, 401);
      try {
        return await route(req, url.pathname);
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
  writeFileSync(sessionPath(), JSON.stringify({ port: server.port, token, pid: process.pid }), { mode: 0o600 });
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
