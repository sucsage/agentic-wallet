// Writes dist/SHA256SUMS.txt and dist/latest.json for a release (run after every file is in dist/).
//   bun run scripts/release-manifest.ts <version> [notes-file]
// latest.json is what the apps and the website's download page read: for each platform the installer
// people download (the windowed app, MilestonePay-<v>-window-<platform>…) with its SHA-256 and size.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";

import { RELEASE_REPO, TAG_PREFIX } from "../src/version";

const [version, notesFile] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Give the version, e.g. 0.2.0");
const tag = `${TAG_PREFIX}${version}`;
const files = readdirSync("dist").filter((f) => !f.startsWith(".") && f !== "SHA256SUMS.txt" && f !== "latest.json");
const sha = (f: string) => createHash("sha256").update(readFileSync(`dist/${f}`)).digest("hex");
const sums = Object.fromEntries(files.map((f) => [f, sha(f)]));
writeFileSync("dist/SHA256SUMS.txt", files.map((f) => `${sums[f]}  ${f}`).join("\n") + "\n");

const PLATFORMS: Record<string, { exe: string; installer: RegExp; label: string }> = {
  "macos-arm64": { exe: "AgenticWallet-macos-arm64", installer: /-macos-arm64\.dmg$/, label: "macOS (Apple silicon)" },
  "macos-x64": { exe: "AgenticWallet-macos-x64", installer: /-macos-x64\.dmg$/, label: "macOS (Intel)" },
  "windows-x64": { exe: "AgenticWallet-windows-x64.exe", installer: /-windows-x64-setup\.exe$/, label: "Windows 10/11 (64-bit)" },
  "linux-x64": { exe: "AgenticWallet-linux-x64", installer: /_amd64\.deb$/, label: "Linux x64" },
  "linux-arm64": { exe: "AgenticWallet-linux-arm64", installer: /_arm64\.deb$/, label: "Linux ARM64" },
};
const assets: Record<string, { file: string; sha256: string; size: number }> = {};
const installers: Record<string, { label: string; file: string; sha256: string; size: number }> = {};
// The same app in its own window (Electrobun): MilestonePay-<v>-window-<platform>…
const windowed: Record<string, { label: string; file: string; sha256: string; size: number }> = {};
for (const [key, p] of Object.entries(PLATFORMS)) {
  if (sums[p.exe]) assets[key] = { file: p.exe, sha256: sums[p.exe], size: statSync(`dist/${p.exe}`).size };
  const inst = files.find((f) => p.installer.test(f));
  if (inst) installers[key] = { label: p.label, file: inst, sha256: sums[inst], size: statSync(`dist/${inst}`).size };
  const win = files.find((f) => f.includes(`-window-${key}`));
  if (win) windowed[key] = { label: p.label, file: win, sha256: sums[win], size: statSync(`dist/${win}`).size };
}
if (!Object.keys(windowed).length) throw new Error("No installer in dist/: every platform's build failed");
const manifest = {
  version,
  tag,
  date: new Date().toISOString(),
  notes: notesFile ? readFileSync(notesFile, "utf8").trim().slice(0, 4000) : "",
  page: `https://github.com/${RELEASE_REPO}/releases/tag/${tag}`,
  // The browser build is gone (0.5.0): installers are the windowed app's. Copies of the browser build
  // find no file for them in assets, so their update card links to the release page.
  assets,
  installers: Object.keys(installers).length ? installers : windowed,
  windowed,
};
writeFileSync("dist/latest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`latest.json: ${Object.keys(assets).length} executables, ${Object.keys(installers).length} installers, ${Object.keys(windowed).length} windowed`);
