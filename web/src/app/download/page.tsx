import type { Metadata } from "next";
import Link from "next/link";

import { PickForThisComputer } from "./pick";
import "./download.css";

export const metadata: Metadata = {
  title: "Download · MilestonePay",
  description: "MilestonePay desktop app for macOS, Windows and Linux (test mode demo).",
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
  "macos-arm64": "Open the .dmg and drag MilestonePay to Applications. First time: right-click the app → Open (or System Settings → Privacy & Security → Open Anyway).",
  "macos-x64": "Open the .dmg and drag MilestonePay to Applications. First time: right-click the app → Open (or System Settings → Privacy & Security → Open Anyway).",
  "windows-x64": "Run the setup. It installs for your user only (no administrator rights). If SmartScreen warns about an unknown publisher: More info → Run anyway.",
  "linux-x64": "sudo apt install ./milestonepay_*_amd64.deb, then open MilestonePay from your apps.",
  "linux-arm64": "sudo apt install ./milestonepay_*_arm64.deb, then open MilestonePay from your apps.",
};

export default async function DownloadPage() {
  const r = await latest();
  const fileUrl = (file: string) => `https://github.com/${REPO}/releases/download/${encodeURIComponent(r!.tag)}/${file}`;
  const list = r
    ? Object.entries(r.installers).map(([key, i]) => {
        const w = r.windowed?.[key];
        return { key, ...i, url: fileUrl(i.file), how: HOW[key] ?? "", window: w ? { url: fileUrl(w.file), size: w.size } : null };
      })
    : [];
  // The windowed app is the main download where it was tested (macOS); elsewhere it is offered as "new".
  const primary = (x: (typeof list)[number]) => (x.window && x.key.startsWith("macos") ? { url: x.window.url, size: x.window.size } : { url: x.url, size: x.size });
  return (
    <main className="dl-page">
      <header className="dl-top">
        <Link href="/" className="dl-brand">
          <span className="dl-mark" />
          MilestonePay
        </Link>
        <Link href="/login">Log in</Link>
      </header>
      <section className="dl-hero">
        <span className="dl-pill">Demo · test money · no real funds</span>
        <h1>MilestonePay for your computer</h1>
        <p>
          Your deals as your own signed chain on your computer: deliver, approve and sign every move with your device key, chat with the AI, and let Claude Desktop or Cursor
          help through MCP. The money stays in the escrow smart contract. The screen opens in your browser.
        </p>
        {r ? (
          <>
            <PickForThisComputer items={list.map((x) => ({ key: x.key, label: x.label, url: primary(x).url, size: mb(primary(x).size) }))} version={r.version} />
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
              {i.window && i.key.startsWith("macos") ? (
                <>
                  <a className="dl-btn" href={i.window.url}>
                    Download · {mb(i.window.size)}
                  </a>
                  <a href={i.url}>Classic version (opens in your browser) · {mb(i.size)}</a>
                </>
              ) : (
                <>
                  <a className="dl-btn" href={i.url}>
                    Download · {mb(i.size)}
                  </a>
                  {i.window && <a href={i.window.url}>New: in its own window (beta) · {mb(i.window.size)}</a>}
                </>
              )}
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
            <li>Open MilestonePay: it opens in your browser.</li>
            <li>Sign up or sign in (the account is made on this website), or link with a code from Profile → Desktop app.</li>
            <li>Choose a passphrase: it encrypts your device key on this computer.</li>
          </ol>
        </div>
        <div>
          <h2>Updates</h2>
          <p>
            The app checks for new versions and updates itself from Settings → App version and updates. Every download is checked against the SHA-256 published with the release
            before it replaces the app. The Linux .deb is updated by installing the new .deb.
          </p>
        </div>
        <div>
          <h2>Safety</h2>
          <p>
            Test mode only (Mock Bank money, Stripe test mode). The app is not signed by Apple or Microsoft, so your computer asks once before opening it. It listens only on this
            computer (127.0.0.1) and only your browser tab, opened by the app, can use it.
          </p>
        </div>
      </section>
    </main>
  );
}
