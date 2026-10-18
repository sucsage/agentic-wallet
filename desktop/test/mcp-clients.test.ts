// The MCP server page edits other apps' config files: it must keep what is there and never break a file.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clientStatus, setClient } from "../src/mcp-clients";

const entry = { command: "/apps/AgenticWallet", args: ["--mcp"] };
let home: string;
let oldHome: string | undefined;
let claudeFile: string;
let cursorFile: string;

beforeAll(() => {
  oldHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "aw-mcp-"));
  process.env.HOME = home;
  process.env.APPDATA = join(home, "AppData");
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  claudeFile = clientStatus(entry).find((c) => c.id === "claude-desktop")!.file;
  cursorFile = clientStatus(entry).find((c) => c.id === "cursor")!.file;
});
afterAll(() => {
  process.env.HOME = oldHome;
  rmSync(home, { recursive: true, force: true });
});

describe("MCP client configs", () => {
  test("adds our server next to the others, backs the file up, and removes only ours", () => {
    mkdirSync(join(claudeFile, ".."), { recursive: true });
    writeFileSync(claudeFile, JSON.stringify({ mcpServers: { other: { command: "x", args: [] } }, theme: "dark" }));
    const after = setClient("claude-desktop", true, entry).find((c) => c.id === "claude-desktop")!;
    expect(after.added && after.current).toBe(true);
    const cfg = JSON.parse(readFileSync(claudeFile, "utf8"));
    expect(cfg.theme).toBe("dark");
    expect(cfg.mcpServers.other.command).toBe("x");
    expect(cfg.mcpServers["agentic-wallet"]).toEqual(entry);
    expect(existsSync(`${claudeFile}.bak-agentic-wallet`)).toBe(true);
    setClient("claude-desktop", false, entry);
    const back = JSON.parse(readFileSync(claudeFile, "utf8"));
    expect(back.mcpServers["agentic-wallet"]).toBeUndefined();
    expect(back.mcpServers.other.command).toBe("x");
  });

  test("an older copy of the app shows as added but not current", () => {
    setClient("claude-desktop", true, { command: "/old/AgenticWallet", args: ["--mcp"] });
    const s = clientStatus(entry).find((c) => c.id === "claude-desktop")!;
    expect(s.added).toBe(true);
    expect(s.current).toBe(false);
  });

  test("never overwrites a config it cannot read", () => {
    mkdirSync(join(cursorFile, ".."), { recursive: true });
    writeFileSync(cursorFile, "{ broken");
    expect(() => setClient("cursor", true, entry)).toThrow(/not valid JSON/);
    expect(readFileSync(cursorFile, "utf8")).toBe("{ broken");
  });

  test("creates the file when the client has none yet, and refuses unknown clients", () => {
    rmSync(cursorFile);
    setClient("cursor", true, entry);
    expect(JSON.parse(readFileSync(cursorFile, "utf8")).mcpServers["agentic-wallet"]).toEqual(entry);
    expect(() => setClient("../../etc", true, entry)).toThrow(/Unknown MCP client/);
  });
});
