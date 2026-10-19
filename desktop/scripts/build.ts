// Builds the app as one executable per OS into dist/ (cross-compiled from any OS by Bun).
//   bun run build            every target
//   bun run build mac-arm64  only the named ones
import { mkdirSync } from "node:fs";

const TARGETS = {
  "windows-x64": { target: "bun-windows-x64", out: "AgenticWallet-windows-x64.exe" },
  "mac-arm64": { target: "bun-darwin-arm64", out: "AgenticWallet-macos-arm64" },
  "mac-x64": { target: "bun-darwin-x64", out: "AgenticWallet-macos-x64" },
  "linux-x64": { target: "bun-linux-x64", out: "AgenticWallet-linux-x64" },
  "linux-arm64": { target: "bun-linux-arm64", out: "AgenticWallet-linux-arm64" },
} as const;

const wanted = process.argv.slice(2);
const names = (wanted.length ? wanted : Object.keys(TARGETS)) as (keyof typeof TARGETS)[];
mkdirSync("dist", { recursive: true });
for (const name of names) {
  const t = TARGETS[name];
  if (!t) throw new Error(`Unknown target ${name}: ${Object.keys(TARGETS).join(", ")}`);
  const args = ["build", "src/main.ts", "--compile", "--minify", `--target=${t.target}`, `--outfile=dist/${t.out}`];
  // On Windows (the release workflow builds there): no console window, the app icon and file details.
  // Bun sets these only when building on Windows itself, not when cross-compiling.
  if (name === "windows-x64" && process.platform === "win32") {
    const version = (await Bun.file("package.json").json()).version as string;
    args.push(
      "--windows-hide-console",
      "--windows-icon=packaging/icons/icon.ico",
      "--windows-title=Kravii",
      "--windows-publisher=Kravii (FinTechathon 2026 demo)",
      `--windows-version=${version}.0`,
      "--windows-description=Kravii desktop app",
    );
  }
  console.log(`> bun ${args.join(" ")}`);
  const p = Bun.spawnSync([process.execPath, ...args], { stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) process.exit(p.exitCode ?? 1);
}
