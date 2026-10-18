import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The MCP clients the app can set up by itself: it adds (or removes) one "agentic-wallet" entry in
 * the client's own config file, only when the user presses the button. The file is backed up first,
 * and a file the app cannot read as JSON is never overwritten. Other clients get the JSON to paste.
 */

export const SERVER_NAME = "agentic-wallet";

type Client = { id: string; name: string; file: string; restart: string };

function clients(): Client[] {
  const home = homedir();
  const claudeDir =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support", "Claude")
      : process.platform === "win32"
        ? join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude")
        : join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Claude");
  return [
    { id: "claude-desktop", name: "Claude Desktop", file: join(claudeDir, "claude_desktop_config.json"), restart: "Quit and reopen Claude Desktop to load it." },
    { id: "cursor", name: "Cursor", file: join(home, ".cursor", "mcp.json"), restart: "Cursor picks it up in Settings → MCP (turn it on there)." },
  ];
}

type Entry = { command: string; args: string[] };

function readConfig(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8");
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Each client: whether it is installed (its config file or folder exists) and whether our entry is there. */
export function clientStatus(entry: Entry) {
  return clients().map((c) => {
    const cfg = readConfig(c.file);
    const mine = cfg && typeof cfg.mcpServers === "object" && cfg.mcpServers ? (cfg.mcpServers as Record<string, Entry>)[SERVER_NAME] : undefined;
    return {
      id: c.id,
      name: c.name,
      file: c.file,
      found: existsSync(c.file) || existsSync(dirname(c.file)),
      readable: cfg !== null,
      added: Boolean(mine),
      current: Boolean(mine && mine.command === entry.command && JSON.stringify(mine.args ?? []) === JSON.stringify(entry.args)),
      restart: c.restart,
    };
  });
}

/** Adds (or updates) our entry in a client's config, or removes it. Backs the file up first. */
export function setClient(id: string, on: boolean, entry: Entry) {
  const c = clients().find((x) => x.id === id);
  if (!c) throw new Error("Unknown MCP client");
  const cfg = readConfig(c.file);
  if (cfg === null) throw new Error(`${c.file} is not valid JSON: fix it or add the server by hand`);
  const servers = (typeof cfg.mcpServers === "object" && cfg.mcpServers ? cfg.mcpServers : {}) as Record<string, unknown>;
  if (on) servers[SERVER_NAME] = { command: entry.command, args: entry.args };
  else if (!(SERVER_NAME in servers)) return clientStatus(entry);
  else delete servers[SERVER_NAME];
  cfg.mcpServers = servers;
  mkdirSync(dirname(c.file), { recursive: true });
  if (existsSync(c.file)) copyFileSync(c.file, `${c.file}.bak-agentic-wallet`);
  writeFileSync(c.file, `${JSON.stringify(cfg, null, 2)}\n`);
  return clientStatus(entry);
}
