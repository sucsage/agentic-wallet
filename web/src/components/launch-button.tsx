"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n";

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
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: session, isPending } = authClient.useSession();
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
      if (!res.ok) throw new Error(body.error ?? t("launch.error"));
      try {
        localStorage.setItem(STORAGE_KEY, body.address);
      } catch {}
      router.push(`/w/${body.address}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!isPending && !session)
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Link className="btn-primary px-5 py-2.5 text-base" href="/login">
            {t("launch.signIn")}
          </Link>
        </div>
        <p className="text-xs text-muted">{t("launch.note")}</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary px-5 py-2.5 text-base" onClick={launch} disabled={busy || isPending}>
          {busy ? t("launch.busy") : t("launch.button")}
        </button>
        {last && !busy && (
          <a className="btn-ghost px-4 py-2.5" href={`/w/${last}`}>
            {t("launch.resume")}
          </a>
        )}
      </div>
      <p className="text-xs text-muted">
        {t("launch.note")}
      </p>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
