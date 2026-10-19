// Finishes the Windows build of the windowed app before it is packed into one Setup.exe (Inno Setup).
//   bun run scripts/win-finish.ts <version> <rcedit.exe>
// Electrobun 1.18 cannot embed the icon itself (its CLI does not find rcedit), and Bun's bun.exe is a
// console program without DPI awareness. So, for bin\launcher.exe and bin\bun.exe:
//   - our icon and name (the taskbar showed Bun's icon and "Bun");
//   - a manifest with per-monitor DPI awareness (Windows stretched the window at 125%/150%: blurry);
//   - bun.exe as a Windows GUI program (it opened a terminal window next to the app).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [version, rcedit] = process.argv.slice(2);
if (!version || !rcedit || !existsSync(rcedit)) throw new Error("Usage: win-finish.ts <version> <rcedit.exe>");

const buildRoot = resolve("electrobun/build");
const stage = readdirSync(buildRoot).find((d) => d.startsWith("stable-win"));
if (!stage) throw new Error("No stable-win build in electrobun/build");
const app = readdirSync(join(buildRoot, stage)).map((d) => join(buildRoot, stage, d)).find((d) => existsSync(join(d, "bin", "launcher.exe")));
if (!app) throw new Error("No app folder with bin\\launcher.exe");
console.log(`App folder: ${app}`);

const icon = resolve("packaging/icons/icon.ico");
const manifest = resolve("packaging/windows/app.manifest");
const v4 = `${version}.0`;
for (const exe of ["launcher.exe", "bun.exe"]) {
  const file = join(app, "bin", exe);
  execFileSync(rcedit, [
    file,
    "--set-icon", icon,
    "--set-version-string", "FileDescription", "MilestonePay",
    "--set-version-string", "ProductName", "MilestonePay",
    "--set-version-string", "CompanyName", "MilestonePay (FinTechathon 2026 demo)",
    "--set-version-string", "OriginalFilename", exe,
    "--set-file-version", v4,
    "--set-product-version", v4,
    "--application-manifest", manifest,
  ], { stdio: "inherit" });
  console.log(`rcedit: ${exe}`);
}

// PE optional header: Subsystem (offset 68) 3 = console, 2 = Windows GUI.
const bun = join(app, "bin", "bun.exe");
const b = readFileSync(bun);
const pe = b.readUInt32LE(0x3c);
if (b.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error("bun.exe is not a PE file");
const at = pe + 24 + 68;
console.log(`bun.exe subsystem ${b.readUInt16LE(at)} -> 2`);
b.writeUInt16LE(2, at);
writeFileSync(bun, b);
// The app folder for Inno Setup.
writeFileSync(resolve("electrobun/build/app-dir.txt"), app);
