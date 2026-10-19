// The app itself, packed for in-place updates (no installer): electrobun/out/Kravii-<v>-app-<platform>.tar.zst
//   bun run scripts/app-archive.ts <version> <platform>
// Windows: the finished app folder (scripts/win-finish.ts: icon, DPI manifest, no terminal window).
// macOS and Linux: Electrobun's own packed app (artifacts/*.tar.zst), the same one its installer unpacks.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const [version, platform] = process.argv.slice(2);
if (!version || !platform) throw new Error("Usage: app-archive.ts <version> <platform>");
const out = resolve("electrobun/out");
mkdirSync(out, { recursive: true });
const target = join(out, `Kravii-${version}-app-${platform}.tar.zst`);

if (process.platform === "win32") {
  const app = readFileSync(resolve("electrobun/build/app-dir.txt"), "utf8").trim();
  if (!existsSync(join(app, "bin", "launcher.exe"))) throw new Error(`No finished app in ${app}`);
  const tarFile = join(out, "app.tar");
  const tar = existsSync("C:\\Windows\\System32\\tar.exe") ? "C:\\Windows\\System32\\tar.exe" : "tar";
  execFileSync(tar, ["-cf", tarFile, "-C", dirname(app), basename(app)], { stdio: "inherit" });
  writeFileSync(target, Bun.zstdCompressSync(readFileSync(tarFile), { level: 19 }));
  rmSync(tarFile, { force: true });
} else {
  const dir = resolve("electrobun/artifacts");
  const packed = readdirSync(dir).filter((f) => f.endsWith(".tar.zst"));
  if (packed.length !== 1) throw new Error(`Expected one .tar.zst in ${dir}, found: ${packed.join(", ") || "none"}`);
  copyFileSync(join(dir, packed[0]), target);
}
console.log(`App archive: ${target}`);
