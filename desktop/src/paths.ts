import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the app keeps its keys, chains and settings: the usual per-user app data folder of each OS. */
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

/**
 * Several accounts on one computer: each has its own folder (profiles/<device address>) with its
 * encrypted key (vault.json) and its chain (chain.db). One is open at a time.
 */
export function profilesDir(): string {
  const dir = join(dataDir(), "profiles");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

let current: string | null = null;

export function setProfile(address: string | null) {
  current = address ? address.toLowerCase() : null;
  if (current) mkdirSync(join(profilesDir(), current), { recursive: true, mode: 0o700 });
}
export const currentProfile = () => current;

function profileDir(): string {
  if (!current) throw new Error("No account chosen");
  return join(profilesDir(), current);
}

export const profileIds = (): string[] =>
  readdirSync(profilesDir(), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(profilesDir(), d.name, "vault.json")))
    .map((d) => d.name);
export const vaultPathOf = (id: string) => join(profilesDir(), id, "vault.json");
export const vaultPath = () => join(profileDir(), "vault.json");
export const chainPath = () => join(profileDir(), "chain.db");
export const sessionPath = () => join(dataDir(), "session.json");
export const lastProfilePath = () => join(dataDir(), "last-account.txt");

/** Version 0.1 kept one account in the data folder itself: move it into its own profile folder. */
export function migrateSingleAccount(readAddress: (vaultFile: string) => string) {
  const old = join(dataDir(), "vault.json");
  if (!existsSync(old)) return;
  const id = readAddress(old).toLowerCase();
  const dir = join(profilesDir(), id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const f of ["vault.json", "chain.db", "chain.db-wal", "chain.db-shm"]) {
    if (existsSync(join(dataDir(), f)) && !existsSync(join(dir, f))) renameSync(join(dataDir(), f), join(dir, f));
  }
}
