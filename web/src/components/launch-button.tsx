"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "agentic-wallet:last";

function readLast(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage unavailable: just don't offer "resume"
  }
}

export function LaunchButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useSyncExternalStore(
    () => () => {},
    readLast,
    () => null,
  );

  async function launch() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create a sandbox");
      try {
        localStorage.setItem(STORAGE_KEY, body.address);
      } catch {}
      router.push(`/w/${body.address}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary px-5 py-2.5 text-base" onClick={launch} disabled={busy}>
          {busy ? "Deploying your sandbox wallet on-chain…" : "Launch my sandbox wallet"}
        </button>
        {last && !busy && (
          <a className="btn-ghost px-4 py-2.5" href={`/w/${last}`}>
            Resume last sandbox
          </a>
        )}
      </div>
      <p className="text-xs text-muted">
        One transaction deploys a private AgentWallet for you, seeded with 10,000 test mUSDC. No sign-up, no real funds.
      </p>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
