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
  /** The windowed app itself, packed (.tar.zst), for updating in place without an installer (since 0.7.0). */
  apps?: Record<string, { file: string; sha256: string; size: number }>;
};

/** Tests only: a release served from this computer (http://127.0.0.1:<port>), never a remote host. */
const LOCAL_RELEASE = /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.AW_UPDATE_BASE ?? "") ? process.env.AW_UPDATE_BASE! : null;
const MANIFEST_URL = LOCAL_RELEASE ? `${LOCAL_RELEASE}/latest.json` : `https://github.com/${RELEASE_REPO}/releases/latest/download/latest.json`;
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

/** The last line the Windows update helper wrote (update-log.txt), e.g. why an update did not go in. */
function lastUpdateNote(): string | null {
  try {
    const lines = readFileSync(join(dataDir(), "update-log.txt"), "utf8").trim().split(/\r?\n/);
    return lines[lines.length - 1]?.slice(0, 300) || null;
  } catch {
    return null;
  }
}

/** What the Settings card shows: this version, the latest, and whether the app can update itself. */
export async function checkUpdate(force = false) {
  const base = { current: VERSION, platform: platformKey(), compiled: compiled(), lastUpdate: lastUpdateNote() };
  try {
    const m = await manifest(force);
    if (!m) return { ...base, latest: null, available: false, canInstall: false, reason: "No release published yet", page: `https://github.com/${RELEASE_REPO}/releases` };
    const available = newer(m.version, VERSION);
    const asset = m.assets[platformKey()];
    const win = m.windowed?.[platformKey()];
    const download = win && /^[\w.-]+$/.test(win.file) ? `https://github.com/${RELEASE_REPO}/releases/download/${encodeURIComponent(m.tag)}/${win.file}` : undefined;
    const reason = process.env.AW_SHELL === "electrobun"
      ? windowedReason(win, m.apps?.[platformKey()])
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

/**
 * The installed app folder on Windows and Linux (the one with bin/), from this process's path
 * (...\Kravii\bin\bun.exe, .../Kravii/bin/bun).
 */
function appFolder(): string | null {
  const bin = dirname(process.execPath);
  if (basename(bin).toLowerCase() !== "bin") return null;
  const root = dirname(bin);
  return existsSync(join(root, "Resources")) ? root : null;
}

/** Why the windowed app cannot update itself here (null: it can). */
function windowedReason(file: { file: string } | undefined, packed?: { file: string }): string | null {
  if (!file && !packed) return "No build for this computer in that release";
  if (process.platform === "win32") {
    if (packed) {
      const root = appFolder();
      if (!root) return "Download the new version and install it over this one: your wallet data stays";
      if (!canWrite(root) || !canWrite(join(root, "bin"))) return `Kravii cannot write to ${root}: download the new version and install it (your wallet data stays)`;
      return null;
    }
    return null;
  }
  if (process.platform === "darwin") {
    const app = macBundle();
    if (!app) return "Download the new version and install it over this one (quit Kravii first): your wallet data stays";
    if (app.startsWith("/Volumes/")) return "Kravii is running from the disk image: drag it to Applications first";
    if (!canWrite(dirname(app)) || !canWrite(app)) return `Kravii cannot write to ${dirname(app)}: download the new version and install it (your wallet data stays)`;
    return null;
  }
  const root = appFolder();
  if (packed && root && canWrite(root) && canWrite(join(root, "bin"))) return null;
  return "Download the new version and install it over this one (quit Kravii first): your wallet data stays";
}

/** Downloads a release file into the updates folder and checks its size and SHA-256. */
async function download(m: Manifest, asset: { file: string; sha256: string; size: number }): Promise<string> {
  if (!/^[\w.-]+$/.test(asset.file) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error("The release information is not readable");
  const url = LOCAL_RELEASE ? `${LOCAL_RELEASE}/${asset.file}` : `https://github.com/${RELEASE_REPO}/releases/download/${encodeURIComponent(m.tag)}/${asset.file}`;
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

/** The new app from its packed copy (.tar.zst), in the updates folder: the folder (or .app) inside it. */
function unpackArchive(archive: string): string {
  const stage = join(updatesDir(), "app");
  mkdirSync(stage, { recursive: true });
  const tar = join(updatesDir(), "app.tar");
  writeFileSync(tar, Bun.zstdDecompressSync(readFileSync(archive)));
  rmSync(archive, { force: true });
  // Windows' own tar (bsdtar) takes C:\ paths.
  const tarExe = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "/usr/bin/tar";
  execFileSync(existsSync(tarExe) ? tarExe : "tar", ["-xf", tar, "-C", stage], { stdio: "ignore", timeout: 180_000, windowsHide: true });
  rmSync(tar, { force: true });
  const found = readdirSync(stage).map((d) => join(stage, d)).find((d) =>
    process.platform === "darwin" ? d.endsWith(".app") && existsSync(join(d, "Contents", "MacOS")) : existsSync(join(d, "bin")) && existsSync(join(d, "Resources")),
  );
  if (!found) throw new Error("The new version could not be unpacked: nothing was changed");
  return found;
}

/** The macOS helper: after this app has quit, the new bundle in place of the old one, then open it. */
function macSwap(installed: string, fresh: string): () => void {
  const target = join(dirname(installed), basename(fresh));
  const script = join(updatesDir(), "swap.sh");
  // If the move fails, the old app goes back.
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
  return () => {
    spawn("/bin/sh", [script, String(process.pid), installed, fresh, target], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => process.exit(0), 600);
  };
}

/**
 * Windows and Linux: after this app has quit, its bin, Resources and lib folders are swapped for the
 * new ones (the old ones go back if a move fails), then the app opens again. On Windows the version
 * in "Installed apps" is updated too.
 */
function folderSwap(root: string, fresh: string, version: string): () => void {
  const parts = ["bin", "Resources", "lib"];
  if (process.platform === "win32") {
    const script = join(updatesDir(), "swap.ps1");
    const log = join(dataDir(), "update-log.txt");
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    // Runs after this app has quit. Its working folder is outside the app (a process whose current
    // folder is inside bin keeps bin from being renamed); each move is retried while Windows still
    // holds files; whatever happens, Kravii is opened again, and the outcome goes to update-log.txt.
    writeFileSync(
      script,
      `$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $env:TEMP
$app = ${q(root)}; $new = ${q(fresh)}; $log = ${q(log)}
function Note($t) { try { Add-Content -LiteralPath $log -Value ("{0} {1}" -f (Get-Date -Format s), $t) } catch {} }
function Retry($what, [scriptblock]$do) {
  for ($i = 0; $i -lt 40; $i++) { try { & $do; return $true } catch { Start-Sleep -Milliseconds 500 } }
  Note "FAILED: $what"; return $false
}
try {
  Note "update to ${version}: waiting for Kravii to close"
  foreach ($id in @(${process.pid}, ${process.ppid})) { try { Wait-Process -Id $id -Timeout 30 -ErrorAction SilentlyContinue } catch {} }
  try { Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith("$app\\", 'OrdinalIgnoreCase') } | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Milliseconds 800
  $parts = @(${parts.map(q).join(", ")})
  $moved = @(); $ok = $true
  foreach ($p in $parts) {
    if (-not (Test-Path -LiteralPath "$new\\$p")) { continue }
    if (Test-Path -LiteralPath "$app\\$p.updating-old") { Remove-Item -LiteralPath "$app\\$p.updating-old" -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath "$app\\$p") {
      if (-not (Retry "move $p aside" { Move-Item -LiteralPath "$app\\$p" -Destination "$app\\$p.updating-old" })) { $ok = $false; break }
    }
    $moved += $p
    if (-not (Retry "move the new $p in" { Move-Item -LiteralPath "$new\\$p" -Destination "$app\\$p" })) { $ok = $false; break }
  }
  if ($ok) {
    foreach ($p in $moved) { Remove-Item -LiteralPath "$app\\$p.updating-old" -Recurse -Force -ErrorAction SilentlyContinue }
    try { Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -eq 'Kravii' } | ForEach-Object { Set-ItemProperty $_.PSPath DisplayVersion ${q(version)} } } catch {}
    Note "OK: ${version} installed"
  } else {
    foreach ($p in $moved) {
      if (Test-Path -LiteralPath "$app\\$p.updating-old") {
        if (Test-Path -LiteralPath "$app\\$p") { Remove-Item -LiteralPath "$app\\$p" -Recurse -Force -ErrorAction SilentlyContinue }
        Move-Item -LiteralPath "$app\\$p.updating-old" -Destination "$app\\$p" -ErrorAction SilentlyContinue
      }
    }
    Note "FAILED: kept the version that was installed"
  }
} catch { Note ("FAILED: " + $_.Exception.Message) }
finally { Start-Process -FilePath "$app\\bin\\launcher.exe" -WorkingDirectory "$app\\bin" }
`,
      "utf8",
    );
    // PowerShell through wscript: no console window flashes up (this app is a windowed program).
    const vbs = join(updatesDir(), "swap.vbs");
    writeFileSync(vbs, `CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${script}""", 0, False\r\n`, "utf8");
    return () => {
      const sys = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
      const wscript = join(sys, "wscript.exe");
      const opts = { detached: true, stdio: "ignore" as const, windowsHide: true, cwd: updatesDir() };
      if (existsSync(wscript)) spawn(wscript, ["//B", "//Nologo", vbs], opts).unref();
      else spawn(join(sys, "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script], opts).unref();
      setTimeout(() => process.exit(0), 600);
    };
  }
  const script = join(updatesDir(), "swap.sh");
  writeFileSync(
    script,
    `#!/bin/sh
PID="$1"; APP="$2"; NEW="$3"
for i in $(seq 1 100); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
OK=1; MOVED=""
for p in ${parts.join(" ")}; do
  [ -e "$NEW/$p" ] || continue
  rm -rf "$APP/$p.updating-old"
  [ -e "$APP/$p" ] && mv "$APP/$p" "$APP/$p.updating-old"
  MOVED="$MOVED $p"
  mv "$NEW/$p" "$APP/$p" || { OK=0; break; }
done
for p in $MOVED; do
  if [ "$OK" = 1 ]; then rm -rf "$APP/$p.updating-old"; else rm -rf "$APP/$p"; mv "$APP/$p.updating-old" "$APP/$p"; fi
done
cd "$APP/bin" && nohup ./launcher >/dev/null 2>&1 &
`,
    { mode: 0o755 },
  );
  return () => {
    spawn("/bin/sh", [script, String(process.pid), root, fresh], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => process.exit(0), 600);
  };
}

/**
 * Downloads and checks the new windowed app, gets it ready, and returns how to finish: `finish()`
 * hands over to a small helper (macOS) or the installer (Windows) and quits this app, which then
 * opens again as the new version.
 */
export async function prepareWindowedUpdate(): Promise<{ version: string; finish: () => void }> {
  const m = await manifest(true);
  if (!m || !newer(m.version, VERSION)) throw new Error("No newer version to install");
  const installer = m.windowed?.[platformKey()];
  const packed = m.apps?.[platformKey()];
  const reason = windowedReason(installer, packed);
  if (reason) throw new Error(reason);
  // Since 0.7.0: the app itself, swapped in place (no installer). Older releases: the installer.
  if (packed) {
    const fresh = unpackArchive(await download(m, packed));
    const finish = process.platform === "darwin" ? macSwap(macBundle()!, fresh) : folderSwap(appFolder()!, fresh, m.version);
    return { version: m.version, finish };
  }
  if (!installer) throw new Error("No build for this computer in the latest release");
  const file = await download(m, installer);
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
  return { version: m.version, finish: macSwap(macBundle()!, unpackMac(file)) };
}

/** Leftovers of an update (the downloaded installer, the unpacked app): removed on the next start. */
export function cleanUpdates() {
  if (existsSync(updatesDir())) rmSync(updatesDir(), { recursive: true, force: true });
}
