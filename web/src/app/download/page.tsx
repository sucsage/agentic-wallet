import type { Metadata } from "next";
import Link from "next/link";

import { PickForThisComputer } from "./pick";
import "./download.css";

export const metadata: Metadata = {
  title: "Download · Kravii",
  description: "Kravii Wallet desktop app for macOS, Windows and Linux (test mode demo).",
};

const REPO = "sucsage/agentic-wallet";

type Installer = { label: string; file: string; sha256: string; size: number };
type Latest = { version: string; tag: string; date: string; notes: string; page: string; installers: Record<string, Installer>; windowed?: Record<string, Installer> };

/**
 * The latest desktop release (its latest.json), read on each visit: a cached "no release yet"
 * would hide a new release, and the file comes from GitHub's download servers, not the rate-limited API.
 */
async function latest(): Promise<Latest | null> {
  try {
    const res = await fetch(`https://github.com/${REPO}/releases/latest/download/latest.json`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const j = (await res.json()) as Latest;
    return j && typeof j.version === "string" && j.installers ? j : null;
  } catch {
    return null;
  }
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;

const HOW: Record<string, string> = {
  "macos-arm64": "Open the .dmg and drag Kravii to Applications, then open it from there (not from the .dmg). First time: right-click → Open (or System Settings → Privacy & Security → Open Anyway); the first start unpacks for about 10 seconds.",
  "macos-x64": "Open the .dmg and drag Kravii to Applications, then open it from there (not from the .dmg). First time: right-click → Open (or System Settings → Privacy & Security → Open Anyway); the first start unpacks for about 10 seconds.",
  "windows-x64": "Run the Setup file and follow the steps (no administrator rights needed); Kravii is then in the Start menu. Older releases came as a .zip: unzip it and run Kravii-Setup.exe. If SmartScreen warns about an unknown publisher: More info → Run anyway.",
  "linux-x64": "Extract it (tar xzf), then run ./installer in that folder. Needs WebKitGTK 4.1 (most desktops have it).",
  "linux-arm64": "Extract it (tar xzf), then run ./installer in that folder. Needs WebKitGTK 4.1 (most desktops have it).",
};

export default async function DownloadPage() {
  const r = await latest();
  const fileUrl = (file: string) => `https://github.com/${REPO}/releases/download/${encodeURIComponent(r!.tag)}/${file}`;
  // The app in its own window (Electrobun): the only build since 0.5.0. Releases before it list the windowed builds next to the classic ones.
  const list = r
    ? Object.entries(r.windowed && Object.keys(r.windowed).length ? r.windowed : r.installers).map(([key, i]) => ({ key, label: i.label, file: i.file, sha256: i.sha256, size: i.size, url: fileUrl(i.file), how: HOW[key] ?? "" }))
    : [];
  return (
    <main className="dl-page">
      <header className="dl-top">
        <Link href="/" className="dl-brand">
          <span className="dl-mark" />
          Kravii
        </Link>
        <Link href="/login">Log in</Link>
      </header>
      <section className="dl-hero">
        <span className="dl-pill">Demo · test money · no real funds</span>
        <h1>Kravii Wallet for your computer</h1>
        <p>
          Your deals as your own signed chain on your computer: deliver, approve and sign every move with your device key, chat with the AI, and let Claude Desktop or Cursor
          help through MCP. The money stays in the escrow smart contract. It runs in its own window, with an icon in the menu bar or tray.
        </p>
        {r ? (
          <>
            <PickForThisComputer items={list.map((x) => ({ key: x.key, label: x.label, url: x.url, size: mb(x.size) }))} version={r.version} />
            <small>
              Version {r.version} · {new Date(r.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} ·{" "}
              <a href={r.page} target="_blank" rel="noreferrer">
                release notes and all files
              </a>
            </small>
          </>
        ) : (
          <p className="dl-none">
            No release is published yet.{" "}
            <a href={`https://github.com/${REPO}/releases`} target="_blank" rel="noreferrer">
              See GitHub Releases
            </a>
            .
          </p>
        )}
      </section>

      {list.length > 0 && (
        <section className="dl-grid">
          {list.map((i) => (
            <article key={i.key} className="dl-card" id={i.key}>
              <h2>{i.label}</h2>
              <a className="dl-btn" href={i.url}>
                Download · {mb(i.size)}
              </a>
              <p>{i.how}</p>
              <code title="SHA-256">sha256 {i.sha256}</code>
            </article>
          ))}
        </section>
      )}

      <section className="dl-notes">
        <div>
          <h2>After installing</h2>
          <ol>
            <li>Open Kravii: it opens in its own window.</li>
            <li>Sign up or sign in (the account is made on this website), or link with a code from Profile → Desktop app.</li>
            <li>Choose a passphrase: it encrypts your device key on this computer.</li>
          </ol>
        </div>
        <div>
          <h2>Updates</h2>
          <p>
            The app tells you when a new version is out (Settings → App version and updates). Download it here and install it over the old one: your wallet data stays.
            Every file is listed with its SHA-256 on the release page.
          </p>
        </div>
        <div>
          <h2>Safety</h2>
          <p>
            Test mode only (Mock Bank money, Stripe test mode). The app is not signed by Apple or Microsoft, so your computer asks once before opening it. Its local server listens only
            on this computer (127.0.0.1) and only the app's own window (with its per-launch token) can use it.
          </p>
        </div>
      </section>
    </main>
  );
}
