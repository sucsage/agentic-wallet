import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the app keeps its key, chain and settings: the usual per-user app data folder of each OS. */
export function dataDir(): string {
  const override = process.env.AGENTIC_WALLET_DATA;
  const dir =
    override ??
    (process.platform === "win32"
      ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "AgenticWallet")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support", "AgenticWallet")
        : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "agentic-wallet"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export const vaultPath = () => join(dataDir(), "vault.json");
export const chainPath = () => join(dataDir(), "chain.db");
export const sessionPath = () => join(dataDir(), "session.json");
