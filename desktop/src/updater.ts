import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { RELEASE_REPO, VERSION } from "./version";

/**
 * Updates from GitHub Releases. Each release carries latest.json (version, notes, and for every
 * platform its file, size and SHA-256). The app downloads its own platform's file, checks the
 * SHA-256 against latest.json, puts it in place of its own executable and restarts. Nothing runs
 * that does not match the hash. Installs the app cannot write to (a Linux .deb in /opt, or running
 * from source) get a link to the release page instead.
 */

export type Manifest = {
  version: string;
  tag: string;
  date: string;
  notes: string;
  page: string;
  assets: Record<string, { file: string; sha256: string; size: number }>;
  /** The windowed app's installers (since 0.4.0). */
  windowed?: Record<string, { file: string; sha256: string; size: number }>;
};

const MANIFEST_URL = `https://github.com/${RELEASE_REPO}/releases/latest/download/latest.json`;
const MAX_SIZE = 250 * 1024 * 1024;

/** This computer's key in latest.json, e.g. macos-arm64, windows-x64, linux-x64. */
export function platformKey(): string {
  const os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform;
  return `${os}-${process.arch}`;
}

/** Running as the built executable (not `bun run src/main.ts`). */
export const compiled = () => !/\bbun(\.exe)?$/i.test(process.execPath);

/** 0.10.0 > 0.9.3: numeric parts compared in order. */
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

function writable(): boolean {
  try {
    accessSync(dirname(process.execPath), constants.W_OK);
    accessSync(process.execPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

let last: { at: number; manifest: Manifest | null; error: string | null } = { at: 0, manifest: null, error: null };

async function manifest(force = false): Promise<Manifest | null> {
  if (!force && Date.now() - last.at < 30 * 60_000) {
    if (last.error) throw new Error(last.error);
    return last.manifest;
  }
  try {
    const res = await fetch(MANIFEST_URL, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "user-agent": `Kravii-Desktop/${VERSION}` } });
    if (res.status === 404) {
      last = { at: Date.now(), manifest: null, error: null };
      return null;
    }
    if (!res.ok) throw new Error(`The release server answered ${res.status}`);
    const m = (await res.json()) as Manifest;
    if (typeof m.version !== "string" || typeof m.assets !== "object") throw new Error("The release information is not readable");
    last = { at: Date.now(), manifest: m, error: null };
    return m;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    last = { at: Date.now(), manifest: null, error };
    throw new Error(error);
  }
}

/** What the Settings card shows: this version, the latest, and whether the app can update itself. */
export async function checkUpdate(force = false) {
  const base = { current: VERSION, platform: platformKey(), compiled: compiled() };
  try {
    const m = await manifest(force);
    if (!m) return { ...base, latest: null, available: false, canInstall: false, reason: "No release published yet", page: `https://github.com/${RELEASE_REPO}/releases` };
    const available = newer(m.version, VERSION);
    const asset = m.assets[platformKey()];
    const win = m.windowed?.[platformKey()];
    const download = win && /^[\w.-]+$/.test(win.file) ? `https://github.com/${RELEASE_REPO}/releases/download/${encodeURIComponent(m.tag)}/${win.file}` : undefined;
    const reason = process.env.AW_SHELL === "electrobun"
      ? "Download the new version and install it over this one (quit Kravii first): your wallet data stays"
      : !compiled()
      ? "Running from source: update with git pull"
      : !asset
        ? "No build for this computer in that release"
        : !writable()
          ? "The app is installed where it cannot write (e.g. the Linux .deb in /opt): install the new version from the release page"
          : null;
    return { ...base, latest: m.version, notes: m.notes, date: m.date, page: m.page, download, available, canInstall: available && reason === null, reason };
  } catch (e) {
    return { ...base, latest: null, available: false, canInstall: false, reason: `Could not check for updates: ${(e as Error).message}`, page: `https://github.com/${RELEASE_REPO}/releases` };
  }
}

/**
 * Downloads this platform's file of the latest release, checks it, and puts it in place of the
 * running executable (Windows: the running file is renamed aside first; it is removed on the next
 * start). Returns the new version; the caller restarts the app.
 */
export async function installUpdate(): Promise<string> {
  const m = await manifest(true);
  if (!m || !newer(m.version, VERSION)) throw new Error("No newer version to install");
  const asset = m.assets[platformKey()];
  if (!asset) throw new Error("No build for this computer in the latest release");
  if (process.env.AW_SHELL === "electrobun" || !compiled() || !writable()) throw new Error("This copy of the app cannot update itself: install the new version from the release page");
  if (!/^[\w.-]+$/.test(asset.file) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error("The release information is not readable");
  const url = `https://github.com/${RELEASE_REPO}/releases/download/${encodeURIComponent(m.tag)}/${asset.file}`;
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60_000), headers: { "user-agent": `Kravii-Desktop/${VERSION}` } });
  if (!res.ok) throw new Error(`The download failed (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_SIZE || (asset.size && bytes.length !== asset.size)) throw new Error("The download has the wrong size: nothing was changed");
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== asset.sha256) throw new Error("The download does not match the release's SHA-256: nothing was changed");
  const exe = process.execPath;
  const fresh = `${exe}.new`;
  writeFileSync(fresh, bytes);
  if (process.platform !== "win32") chmodSync(fresh, 0o755);
  if (process.platform === "win32") {
    rmSync(`${exe}.old`, { force: true });
    renameSync(exe, `${exe}.old`);
  }
  try {
    renameSync(fresh, exe);
  } catch (e) {
    if (process.platform === "win32" && existsSync(`${exe}.old`)) renameSync(`${exe}.old`, exe);
    throw e;
  }
  return m.version;
}

/** Windows keeps the replaced executable as .old until the next start. */
export function cleanOldExecutable() {
  if (process.platform === "win32") rmSync(`${process.execPath}.old`, { force: true });
}
