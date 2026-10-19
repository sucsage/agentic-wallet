import { homedir } from "node:os";
import { join } from "node:path";

import { wallet } from "./core";
import { type ServerEntry, type ToolDef, safeName } from "./mcp-host";
import { RECOMMENDED, type Suggestion, WEB_SERVER, searchRegistry } from "./web-tools";

/**
 * Adding MCP servers: from the MCP page (a recommended server or a registry result) and from the AI
 * chat (the app's own tools below: find a server, then add it after the user allows that call). Only
 * what can run safely without pasting code: a remote https URL, or an npm package run with the app's
 * own Bun. A server that needs a key is added turned off, for the user to fill in first.
 */

/** {documents} in a suggestion's arguments: this computer's Documents folder. */
export function expand(e: ServerEntry): ServerEntry {
  return { command: e.command, args: (e.args ?? []).map((a) => String(a).replace("{documents}", join(homedir(), "Documents"))) };
}

/** Whether a suggestion is already set up here (same URL, or same package and arguments). */
export function installed(s: Suggestion): boolean {
  return Object.values(wallet.mcpServers()).some((c) => JSON.stringify(c.url ?? c.args) === JSON.stringify(s.entry.url ?? expand(s.entry).args));
}

/** Adds a suggested server. Returns the name it got and whether it is on (off while it needs a key). */
export function installSuggestion(s: Suggestion): { name: string; enabled: boolean; needs: string[] } {
  if (!s || !s.entry) throw new Error("Choose a server");
  const e = s.entry;
  const remote = typeof e.url === "string" && /^https:\/\/[^\s{}]+$/.test(e.url);
  const npm = e.command === "bun" && Array.isArray(e.args) && e.args[0] === "x" && /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(String(e.args[1] ?? ""));
  if (!remote && !npm) throw new Error("That server cannot be added this way: paste its config on the MCP page instead");
  const list = wallet.mcpServers();
  let name = safeName(s.name || "server");
  for (let i = 2; list[name] || name === WEB_SERVER || name === APP_SERVER; i++) name = `${safeName(s.name || "server").slice(0, 36)}_${i}`;
  const entry: ServerEntry = remote
    ? { url: e.url, ...(e.headers ? { headers: Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [String(k), String(v)])) } : {}) }
    : { ...expand(e), ...(e.env ? { env: Object.fromEntries(Object.entries(e.env).map(([k, v]) => [String(k), String(v)])) } : {}) };
  const needs = s.needs ?? [];
  list[name] = { ...entry, enabled: needs.length === 0, ask: true, source: s.site || s.id };
  wallet.saveMcpServers(list);
  return { name, enabled: needs.length === 0, needs };
}

// ---------------------------------------------------------------------------------------------
// The AI chat's own tools for this (mcp__kravii__…), run on this computer like the web tools.
// ---------------------------------------------------------------------------------------------

export const APP_SERVER = "kravii";

export const APP_TOOLS: ToolDef[] = [
  {
    name: "mcp__kravii__find_mcp_servers",
    description:
      "[Built into the Kravii app, runs on the user's computer] Find MCP servers the user can add to this app: the app's recommended ones, plus a search of the official MCP Registry when a query is given (e.g. github, notion, weather, postgres). Returns each server's id, what it does, whether it is already added and whether it needs a key. Use it when the user asks to install, add or connect an MCP server or a tool.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "What to search for; empty for the recommended list" } }, required: [] },
  },
  {
    name: "mcp__kravii__add_mcp_server",
    description:
      "[Built into the Kravii app, runs on the user's computer] Add one MCP server: by its id from mcp__kravii__find_mcp_servers, OR by a source the user gave: a GitHub repository URL (its npm package is used), an npm package name (e.g. @scope/name), an npmjs.com package link, or a remote MCP URL (https). The user is asked to allow this call first. A server that needs a key or a login is added; tell the user to fill those in on the MCP page (its README says which). Its tools are available in the next message.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The id from find_mcp_servers" },
        source: { type: "string", description: "Or: a GitHub repo URL, an npm package name, an npmjs.com link, or a remote https MCP URL" },
      },
      required: [],
    },
  },
];

/** The last search's results by id, so add_mcp_server can take one by its id. */
const found = new Map<string, Suggestion>();

const NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;

/** The npm package's latest version and description, if it is published. */
async function npmPackage(name: string): Promise<{ version: string; description: string } | null> {
  if (!NPM_NAME.test(name)) return null;
  const r = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/vnd.npm.install-v1+json" } }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = (await r.json().catch(() => null)) as { "dist-tags"?: { latest?: string }; description?: string } | null;
  const v = j?.["dist-tags"]?.latest;
  return v ? { version: v, description: j?.description ?? "" } : null;
}

/**
 * A server from what the user pasted: a GitHub repository (its package.json names the npm package
 * it publishes), an npm package name or npmjs.com link, or a remote MCP URL. Nothing is run here.
 */
export async function suggestionFromSource(raw: string): Promise<Suggestion> {
  const src = raw.trim();
  let name: string | null = null;
  let site: string | undefined;
  const gh = src.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  const npmLink = src.match(/^https:\/\/(?:www\.)?npmjs\.com\/package\/((?:@[\w.-]+\/)?[\w.-]+)/i);
  if (gh) {
    site = `https://github.com/${gh[1]}/${gh[2]}`;
    for (const branch of ["main", "master"]) {
      const r = await fetch(`https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${branch}/package.json`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (r && r.ok) {
        const pkg = (await r.json().catch(() => null)) as { name?: string; private?: boolean } | null;
        if (pkg?.name && !pkg.private) name = pkg.name;
        break;
      }
    }
    if (!name) throw new Error(`${site} has no npm package the app can run (no package.json with a published name). Add it on the MCP page with its config instead.`);
  } else if (npmLink) {
    name = npmLink[1];
    site = src;
  } else if (/^https:\/\//i.test(src)) {
    const host = new URL(src).hostname;
    return { id: `url:${src}`, name: safeName(host.split(".").slice(-2, -1)[0] || "remote"), title: host, description: "Remote MCP server", kind: "remote", entry: { url: src }, site: src };
  } else if (NPM_NAME.test(src.replace(/@[\w.^~-]+$/, ""))) {
    name = src.replace(/(.)@[\w.^~-]+$/, "$1");
  }
  if (!name) throw new Error("Give a GitHub repository URL, an npm package name, or a remote https MCP URL");
  const pkg = await npmPackage(name);
  if (!pkg) throw new Error(`${name} is not published on npm, so the app cannot run it. Add it on the MCP page with its config instead.`);
  const short = name.replace(/^@[\w.-]+\//, "").replace(/[-_]?mcp[-_]?(server)?/gi, "") || name;
  return { id: `npm:${name}`, name: safeName(short), title: name, description: pkg.description, kind: "npm", entry: { command: "bun", args: ["x", `${name}@${pkg.version}`] }, site: site ?? `https://www.npmjs.com/package/${name}` };
}

const view = (s: Suggestion) => ({ id: s.id, title: s.title, what: s.description.slice(0, 240), kind: s.kind, added: installed(s), needs_key: s.needs?.length ? s.needs : undefined });

export async function runAppTool(tool: string, input: unknown): Promise<{ text: string; isError?: boolean }> {
  const i = (input ?? {}) as Record<string, unknown>;
  try {
    if (tool === "find_mcp_servers") {
      const q = String(i.query ?? "").trim().slice(0, 80);
      // The registry can be slow: the chat waits at most 12 s for it, then answers with the recommended list.
      const searched = q ? await Promise.race([searchRegistry(q).catch(() => null), new Promise<null>((ok) => setTimeout(() => ok(null), 12_000))]) : [];
      const results = searched ?? [];
      for (const s of [...RECOMMENDED, ...results]) found.set(s.id, s);
      return { text: JSON.stringify({ recommended: RECOMMENDED.map(view), results: results.map(view), ...(searched === null ? { note: "The MCP Registry did not answer in time: only the recommended servers are listed" } : {}) }) };
    }
    if (tool === "add_mcp_server") {
      const id = String(i.id ?? "");
      const source = String(i.source ?? "").trim();
      const s = source ? await suggestionFromSource(source) : found.get(id) ?? RECOMMENDED.find((x) => x.id === id);
      if (!s) return { text: "Unknown id: call mcp__kravii__find_mcp_servers first and use an id it returned, or pass the source the user gave.", isError: true };
      if (installed(s)) return { text: `${s.title} is already added on this computer.` };
      const r = installSuggestion(s);
      return {
        text: r.enabled
          ? `Added ${s.title} as "${r.name}"${s.kind === "npm" ? ` (npm package ${String(s.entry.args?.[1] ?? "")}, run with the app's Bun)` : ""}. Its tools are available from the user's next message; the user is asked before each call. If it needs a key, credentials or a login (see ${s.site ?? "its README"}), the user adds them on the MCP page under Edit config (env); until then it may show an error there.`
          : `Added ${s.title} as "${r.name}", turned OFF: it needs ${r.needs.join(", ")}. Tell the user to open the MCP page, fill that in under Edit config, and turn it on.`,
      };
    }
    return { text: `Unknown tool ${tool}`, isError: true };
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
}
