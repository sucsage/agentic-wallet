"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { type Key, LangToggle, useT } from "@/lib/i18n";
import type { Sample } from "@/lib/samples";

import { Chat } from "./chat";
import { ApprovalsPanel, AuditPanel, DealsPanel, LastAction, WalletPanel, useActions } from "./panels";
import type { Workspace as WorkspaceState } from "./ui";

const GUIDE: Key[] = ["ws.guide.1", "ws.guide.2", "ws.guide.3", "ws.guide.4", "ws.guide.5", "ws.guide.6"];

export function Workspace({ address }: { address: string }) {
  const { t } = useT();
  const [ws, setWs] = useState<WorkspaceState | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${address}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load wallet");
      setWs(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [address]);

  const { busy, last, run, clear } = useActions(address, refresh);

  useEffect(() => {
    // refresh() only sets state after an awaited fetch, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    fetch("/api/samples")
      .then((r) => r.json())
      .then((s) => Array.isArray(s) && setSamples(s))
      .catch(() => {});
    try {
      localStorage.setItem("agentic-wallet:last", address);
    } catch {}
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [address, refresh]);

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-fg">AW</span>
          Agentic Wallet
          <span className="pill bg-surface-2 font-normal text-muted">{t("brand.sandbox")}</span>
        </Link>
        <div className="flex items-center gap-2">
          <button className="btn-ghost text-xs" onClick={() => setGuideOpen((v) => !v)}>
            {guideOpen ? t("ws.guide.hide") : t("ws.guide.show")}
          </button>
          <LangToggle />
        </div>
      </header>

      {guideOpen && (
        <ol className="card grid gap-2 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {GUIDE.map((g, i) => (
            <li key={i} className="flex gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                {i + 1}
              </span>
              <span className="text-muted">{t(g)}</span>
            </li>
          ))}
        </ol>
      )}

      {error && !ws && <div className="card p-6 text-sm text-bad">{error}</div>}
      {!ws && !error && <div className="card p-6 text-sm text-muted">{t("ws.loading")}</div>}

      {ws && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
            <Chat address={address} samples={samples} model={ws.model} onChanged={refresh} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <LastAction last={last} busy={busy} clear={clear} />
            <WalletPanel ws={ws} run={run} busy={busy} />
            <ApprovalsPanel ws={ws} run={run} busy={busy} />
            <DealsPanel ws={ws} samples={samples} run={run} busy={busy} />
            <AuditPanel ws={ws} />
          </div>
        </div>
      )}
    </main>
  );
}
