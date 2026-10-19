import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { dataDir } from "./paths";
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
      ? windowedReason(win)
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

// ---------------------------------------------------------------------------------------------
// The windowed app (Electrobun, AW_SHELL=electrobun): updates itself from the release's installer.
//   macOS: the .dmg holds a small self-unpacking Kravii.app; the update unpacks the full app from it
//          and, once this app has quit, puts it in place of the installed one and opens it.
//   Windows: the Setup.exe runs silently over the installed app and opens Kravii again.
//   Linux: the Download button (the installer there is interactive).
// The installer is checked against the release's SHA-256 before anything is unpacked or run.
// ---------------------------------------------------------------------------------------------

const updatesDir = () => join(dataDir(), "updates");

/** The installed bundle on macOS (.../Kravii.app), from this process's path (.../Kravii.app/Contents/MacOS/bun). */
function macBundle(): string | null {
  const m = process.execPath.match(/^(.*?\.app)\/Contents\/MacOS\/[^/]+$/);
  return m ? m[1] : null;
}

function canWrite(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Why the windowed app cannot update itself here (null: it can). */
function windowedReason(file: { file: string } | undefined): string | null {
  if (!file) return "No build for this computer in that release";
  if (process.platform === "win32") return null;
  if (process.platform === "darwin") {
    const app = macBundle();
    if (!app) return "Download the new version and install it over this one (quit Kravii first): your wallet data stays";
    if (app.startsWith("/Volumes/")) return "Kravii is running from the disk image: drag it to Applications first";
    if (!canWrite(dirname(app)) || !canWrite(app)) return `Kravii cannot write to ${dirname(app)}: download the new version and install it (your wallet data stays)`;
    return null;
  }
  return "Download the new version and install it over this one (quit Kravii first): your wallet data stays";
}

/** Downloads a release file into the updates folder and checks its size and SHA-256. */
async function download(m: Manifest, asset: { file: string; sha256: string; size: number }): Promise<string> {
  if (!/^[\w.-]+$/.test(asset.file) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error("The release information is not readable");
  const url = `https://github.com/${RELEASE_REPO}/releases/download/${encodeURIComponent(m.tag)}/${asset.file}`;
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60_000), headers: { "user-agent": `Kravii-Desktop/${VERSION}` } });
  if (!res.ok) throw new Error(`The download failed (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_SIZE || (asset.size && bytes.length !== asset.size)) throw new Error("The download has the wrong size: nothing was changed");
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("The download does not match the release's SHA-256: nothing was changed");
  rmSync(updatesDir(), { recursive: true, force: true });
  mkdirSync(updatesDir(), { recursive: true });
  const path = join(updatesDir(), asset.file);
  writeFileSync(path, bytes);
  return path;
}

/** macOS: the full app from the .dmg's self-unpacking bundle, in the updates folder. */
function unpackMac(dmg: string): string {
  const mnt = join(updatesDir(), "mnt");
  const stage = join(updatesDir(), "app");
  mkdirSync(mnt, { recursive: true });
  mkdirSync(stage, { recursive: true });
  execFileSync("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mnt, dmg], { stdio: "ignore", timeout: 120_000 });
  try {
    const wrapper = readdirSync(mnt).find((f) => f.endsWith(".app"));
    if (!wrapper) throw new Error("No app in the disk image");
    const res = join(mnt, wrapper, "Contents", "Resources");
    const packed = readdirSync(res).find((f) => f.endsWith(".tar.zst"));
    if (packed) {
      const tar = join(updatesDir(), "app.tar");
      writeFileSync(tar, Bun.zstdDecompressSync(readFileSync(join(res, packed))));
      execFileSync("/usr/bin/tar", ["-xf", tar, "-C", stage], { stdio: "ignore", timeout: 120_000 });
      rmSync(tar, { force: true });
    } else {
      // A disk image with the full app in it: copy it as it is.
      execFileSync("/usr/bin/ditto", [join(mnt, wrapper), join(stage, wrapper)], { stdio: "ignore", timeout: 120_000 });
    }
  } finally {
    try {
      execFileSync("/usr/bin/hdiutil", ["detach", mnt, "-force"], { stdio: "ignore", timeout: 60_000 });
    } catch {
      // detached already
    }
  }
  const app = readdirSync(stage).find((f) => f.endsWith(".app"));
  if (!app || !existsSync(join(stage, app, "Contents", "MacOS"))) throw new Error("The new version could not be unpacked: nothing was changed");
  return join(stage, app);
}

/**
 * Downloads and checks the new windowed app, gets it ready, and returns how to finish: `finish()`
 * hands over to a small helper (macOS) or the installer (Windows) and quits this app, which then
 * opens again as the new version.
 */
export async function prepareWindowedUpdate(): Promise<{ version: string; finish: () => void }> {
  const m = await manifest(true);
  if (!m || !newer(m.version, VERSION)) throw new Error("No newer version to install");
  const asset = m.windowed?.[platformKey()];
  const reason = windowedReason(asset);
  if (reason || !asset) throw new Error(reason ?? "No build for this computer in the latest release");
  const file = await download(m, asset);
  if (process.platform === "win32") {
    return {
      version: m.version,
      finish: () => {
        // The installer closes this app, installs over it and opens Kravii again (its [Run] for silent installs).
        spawn(file, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS"], { detached: true, stdio: "ignore" }).unref();
        setTimeout(() => process.exit(0), 1500);
      },
    };
  }
  const installed = macBundle()!;
  const fresh = unpackMac(file);
  const target = join(dirname(installed), basename(fresh));
  const script = join(updatesDir(), "swap.sh");
  // After this app has quit: the installed app aside, the new one in its place, then open it. If the
  // move fails, the old app goes back.
  writeFileSync(
    script,
    `#!/bin/sh
PID="$1"; OLD="$2"; NEW="$3"; TARGET="$4"
for i in $(seq 1 100); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
rm -rf "$OLD.updating-old"
if mv "$OLD" "$OLD.updating-old"; then
  if mv "$NEW" "$TARGET" 2>/dev/null || /usr/bin/ditto "$NEW" "$TARGET"; then
    rm -rf "$OLD.updating-old"
  else
    rm -rf "$TARGET"; mv "$OLD.updating-old" "$OLD"; TARGET="$OLD"
  fi
fi
/usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
if [ -n "$AGENTIC_WALLET_DATA" ]; then open --env AGENTIC_WALLET_DATA="$AGENTIC_WALLET_DATA" "$TARGET"; else open "$TARGET"; fi
`,
    { mode: 0o755 },
  );
  return {
    version: m.version,
    finish: () => {
      spawn("/bin/sh", [script, String(process.pid), installed, fresh, target], { detached: true, stdio: "ignore" }).unref();
      setTimeout(() => process.exit(0), 600);
    },
  };
}

/** Leftovers of an update (the downloaded installer, the unpacked app): removed on the next start. */
export function cleanUpdates() {
  if (existsSync(updatesDir())) rmSync(updatesDir(), { recursive: true, force: true });
}
