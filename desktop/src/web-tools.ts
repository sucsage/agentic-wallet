import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { ServerEntry, ToolDef } from "./mcp-host";
import { VERSION } from "./version";

/**
 * The app's own web tools for MilestonePay's AI: search the web and read a page. They run on this
 * computer like the user's MCP servers (the AI sees them as mcp__web__search and mcp__web__read_page),
 * with no API key: search uses DuckDuckGo's HTML results. What they return is untrusted data; the
 * server fences it for the AI like any MCP result.
 *
 * Also the MCP finder for the MCP page: a few recommended servers that work here (an npm package run
 * with the app's own Bun, or a remote URL, and no key), and a search of the official MCP Registry.
 */

export const WEB_SERVER = "web";
export const WEB_TOOLS: ToolDef[] = [
  {
    name: "mcp__web__search",
    description:
      "[Built into the MilestonePay app, runs on the user's computer] Search the web (DuckDuckGo). Use it for facts the wallet does not hold: market prices for a job, a company's public site, how a service usually works. Never put the user's personal data, balances, account numbers, addresses or deal details in the query. Returns titles, links and snippets.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "What to search for (no personal data)" }, max: { type: "number", description: "Results, 1-10 (default 6)" } }, required: ["query"] },
  },
  {
    name: "mcp__web__read_page",
    description:
      "[Built into the MilestonePay app, runs on the user's computer] Read a public web page (http/https) as plain text, e.g. a result from mcp__web__search. Never add the user's data to the URL.",
    input_schema: { type: "object", properties: { url: { type: "string", description: "The page's full URL" } }, required: ["url"] },
  },
];

const UA = `Mozilla/5.0 (compatible; MilestonePay-Desktop/${VERSION})`;
const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

/** DuckDuckGo's result links go through a redirect (//duckduckgo.com/l/?uddg=<url>): the real URL. */
function realUrl(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    return u.hostname.endsWith("duckduckgo.com") && u.searchParams.get("uddg") ? u.searchParams.get("uddg")! : u.href;
  } catch {
    return href;
  }
}

export async function webSearch(query: string, max = 6): Promise<{ title: string; url: string; snippet: string }[]> {
  const q = query.trim().slice(0, 300);
  if (!q) throw new Error("Give a search query");
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA, accept: "text/html" },
    body: new URLSearchParams({ q, kl: "wt-wt" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`The search answered ${res.status}`);
  const html = await res.text();
  const out: { title: string; url: string; snippet: string }[] = [];
  const blocks = html.split(/class="result results_links/).slice(1);
  for (const b of blocks) {
    const a = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!a) continue;
    const sn = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    const url = realUrl(a[1].replace(/&amp;/g, "&"));
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    out.push({ title: decode(a[2]), url, snippet: sn ? decode(sn[1]) : "" });
    if (out.length >= Math.min(10, Math.max(1, max))) break;
  }
  if (!out.length && /anomaly|captcha/i.test(html)) throw new Error("The search engine asked for a check: try again in a minute");
  return out;
}

/** Only public hosts: never this computer or its local network (the app's own server lives on 127.0.0.1). */
function publicHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !isIP(h)) return false;
  if (isIP(h) === 4) {
    const [a, b] = h.split(".").map(Number);
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
  }
  if (isIP(h) === 6) return !(h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:"));
  return true;
}

export async function readPage(raw: string): Promise<{ url: string; title: string; text: string }> {
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new Error("That is not a full URL");
  }
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new Error("Only http and https pages");
    if (!publicHost(url.hostname)) throw new Error("Only public web pages (not this computer or its local network)");
    // A public name that points at a local address is refused too.
    if (!isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
      const addrs = await lookup(url.hostname, { all: true }).catch(() => []);
      if (!addrs.length) throw new Error(`Cannot find ${url.hostname}`);
      if (addrs.some((a) => !publicHost(a.address))) throw new Error("Only public web pages (not this computer or its local network)");
    }
    const res = await fetch(url, { redirect: "manual", headers: { "user-agent": UA, accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" }, signal: AbortSignal.timeout(20_000) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) throw new Error(`The page answered ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/|json|xml/.test(type)) throw new Error(`Not a text page (${type || "unknown type"})`);
    const body = (await res.text()).slice(0, 2_000_000);
    if (!/html/.test(type)) return { url: url.href, title: url.href, text: body.slice(0, 15_000) };
    const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? url.href);
    const text = body
      .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .split("\n")
      .map(decode)
      .filter(Boolean)
      .join("\n");
    return { url: url.href, title, text: text.slice(0, 15_000) };
  }
  throw new Error("Too many redirects");
}

/** Runs one of the web tools; the result as text for the AI. */
export async function runWebTool(tool: string, input: unknown): Promise<{ text: string; isError: boolean }> {
  const i = (input ?? {}) as { query?: unknown; max?: unknown; url?: unknown };
  try {
    if (tool === "search") {
      const hits = await webSearch(String(i.query ?? ""), Number(i.max) || 6);
      return { text: hits.length ? hits.map((h, n) => `${n + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join("\n") : "No results.", isError: false };
    }
    if (tool === "read_page") {
      const p = await readPage(String(i.url ?? ""));
      return { text: `${p.title}\n${p.url}\n\n${p.text}`, isError: false };
    }
    return { text: `Unknown web tool ${tool}`, isError: true };
  } catch (e) {
    return { text: (e as Error).message, isError: true };
  }
}

export type Suggestion = { id: string; name: string; title: string; description: string; kind: "npm" | "remote"; entry: ServerEntry; needs?: string[]; site?: string };

/** Servers that work in the app as they are: no key, an npm package (run with the app's Bun) or a public remote URL. */
export const RECOMMENDED: Suggestion[] = [
  {
    id: "deepwiki",
    name: "deepwiki",
    title: "DeepWiki",
    description: "Ask about any public GitHub repository: what it does and how to use it (remote, by Cognition).",
    kind: "remote",
    entry: { url: "https://mcp.deepwiki.com/mcp" },
    site: "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
  },
  {
    id: "context7",
    name: "context7",
    title: "Context7",
    description: "Current documentation and code examples for libraries and APIs (remote, by Upstash).",
    kind: "remote",
    entry: { url: "https://mcp.context7.com/mcp" },
    site: "https://github.com/upstash/context7",
  },
  {
    id: "mslearn",
    name: "microsoft_learn",
    title: "Microsoft Learn",
    description: "Search Microsoft's official documentation (remote).",
    kind: "remote",
    entry: { url: "https://learn.microsoft.com/api/mcp" },
    site: "https://github.com/MicrosoftDocs/mcp",
  },
  {
    id: "memory",
    name: "memory",
    title: "Memory",
    description: "A small knowledge graph the AI keeps on this computer: people, preferences, facts to remember between chats.",
    kind: "npm",
    entry: { command: "bun", args: ["x", "@modelcontextprotocol/server-memory"] },
    site: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    id: "thinking",
    name: "sequential_thinking",
    title: "Sequential thinking",
    description: "Lets the AI plan a long task step by step before it answers.",
    kind: "npm",
    entry: { command: "bun", args: ["x", "@modelcontextprotocol/server-sequential-thinking"] },
    site: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
  },
  {
    id: "files",
    name: "documents",
    title: "Files (Documents folder)",
    description: "Read and write files in your Documents folder only, e.g. to read a quote or save a summary.",
    kind: "npm",
    entry: { command: "bun", args: ["x", "@modelcontextprotocol/server-filesystem", "{documents}"] },
    site: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
];

type RegistryServer = {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: { url?: string };
  packages?: { registryType?: string; identifier?: string; version?: string; transport?: { type?: string }; environmentVariables?: { name: string; isRequired?: boolean; description?: string }[]; packageArguments?: { isRequired?: boolean }[] }[];
  remotes?: { type?: string; url?: string; headers?: { name: string; isRequired?: boolean }[] }[];
};

/**
 * Searches the official MCP Registry (registry.modelcontextprotocol.io) and keeps the servers the app
 * can run: an npm package over stdio, or a streamable HTTP URL. What a server still needs (keys,
 * folders) is listed so the user can fill it in before turning it on.
 */
export async function searchRegistry(q: string): Promise<Suggestion[]> {
  const term = q.trim().slice(0, 80);
  if (!term) return [];
  const res = await fetch(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(term)}&version=latest&limit=40`, {
    headers: { "user-agent": UA, accept: "application/json" },
    // The registry can take 15 seconds or more to answer a search.
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`The MCP Registry answered ${res.status}`);
  const j = (await res.json()) as { servers?: { server: RegistryServer }[] };
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const { server: s } of j.servers ?? []) {
    if (!s?.name || seen.has(s.name)) continue;
    const short = s.name.split("/").pop() ?? s.name;
    const base = { id: s.name, name: short.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40), title: s.title || short, description: (s.description ?? "").slice(0, 300), site: s.websiteUrl || s.repository?.url };
    const remote = (s.remotes ?? []).find((r) => r.type === "streamable-http" && r.url && !/\{/.test(r.url));
    const pkg = (s.packages ?? []).find((p) => p.registryType === "npm" && p.identifier && (p.transport?.type ?? "stdio") === "stdio");
    if (remote) {
      const needs = (remote.headers ?? []).filter((h) => h.isRequired).map((h) => `header ${h.name}`);
      const headers = Object.fromEntries((remote.headers ?? []).filter((h) => h.isRequired).map((h) => [h.name, ""]));
      out.push({ ...base, kind: "remote", entry: { url: remote.url!, ...(needs.length ? { headers } : {}) }, needs: needs.length ? needs : undefined });
    } else if (pkg) {
      const needs = [...(pkg.environmentVariables ?? []).filter((e) => e.isRequired).map((e) => e.name), ...((pkg.packageArguments ?? []).some((a) => a.isRequired) ? ["arguments (see its page)"] : [])];
      const env = Object.fromEntries((pkg.environmentVariables ?? []).filter((e) => e.isRequired).map((e) => [e.name, ""]));
      out.push({ ...base, kind: "npm", entry: { command: "bun", args: ["x", pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier!], ...(Object.keys(env).length ? { env } : {}) }, needs: needs.length ? needs : undefined });
    } else continue;
    seen.add(s.name);
    if (out.length >= 20) break;
  }
  return out;
}
