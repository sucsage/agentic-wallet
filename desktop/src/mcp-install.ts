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
      "[Built into the Kravii app, runs on the user's computer] Add one MCP server found with mcp__kravii__find_mcp_servers, by its id. The user is asked to allow this call first. Only servers the app can add safely (a remote https URL or an npm package) can be added; a server that needs a key is added turned off and the user fills it in on the MCP page. Its tools are available in the next message.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The id from find_mcp_servers" } }, required: ["id"] },
  },
];

/** The last search's results by id, so add_mcp_server can take one by its id. */
const found = new Map<string, Suggestion>();

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
      const s = found.get(id) ?? RECOMMENDED.find((x) => x.id === id);
      if (!s) return { text: "Unknown id: call mcp__kravii__find_mcp_servers first and use an id it returned.", isError: true };
      if (installed(s)) return { text: `${s.title} is already added on this computer.` };
      const r = installSuggestion(s);
      return {
        text: r.enabled
          ? `Added ${s.title} as "${r.name}". Its tools are available from the user's next message; the user is asked before each call (they can change that on the MCP page).`
          : `Added ${s.title} as "${r.name}", turned OFF: it needs ${r.needs.join(", ")}. Tell the user to open the MCP page, fill that in under Edit config, and turn it on.`,
      };
    }
    return { text: `Unknown tool ${tool}`, isError: true };
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
}
