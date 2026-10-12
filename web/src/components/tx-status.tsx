"use client";

import type { TxOutcome } from "@/lib/chain";
import { useT } from "@/lib/i18n";

type TxStatusProps = {
  outcome?: TxOutcome | null;
  loading?: boolean;
  error?: string | null;
  className?: string;
};

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function TxStatus({ outcome, loading = false, error, className = "" }: TxStatusProps) {
  const { t } = useT();
  const boxClass = `rounded-lg border px-3 py-2 text-sm ${className}`;

  if (loading) {
    return (
      <div role="status" aria-live="polite" className={`${boxClass} border-border bg-surface-2 text-muted`}>
        <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
        {t("tx.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className={`${boxClass} border-bad/30 bg-bad-soft text-bad`}>
        <strong>{t("tx.error")}</strong> {error}
      </div>
    );
  }

  if (!outcome) return null;

  if (outcome.status === "rejected") {
    return (
      <div role="status" className={`${boxClass} border-bad/30 bg-bad-soft text-bad`}>
        <strong>{t("outcome.rejected")}</strong> {outcome.error}
      </div>
    );
  }

  const success = outcome.status === "success";
  return (
    <div
      role="status"
      className={`${boxClass} ${success ? "border-ok/30 bg-ok-soft text-ok" : "border-bad/30 bg-bad-soft text-bad"}`}
    >
      <div>
        <strong>{success ? t("outcome.confirmed") : t("outcome.reverted")}</strong>
        {!success && <span> {outcome.error}</span>}
      </div>
      {outcome.url ? (
        <a
          className="mt-1 inline-block font-mono text-xs underline underline-offset-2"
          href={outcome.url}
          target="_blank"
          rel="noreferrer"
          title={outcome.hash}
        >
          {t("tx.viewExplorer")} · {shortHash(outcome.hash)} ↗
        </a>
      ) : (
        <div className="mt-1 font-mono text-xs" title={outcome.hash}>
          {t("tx.hash")} · {shortHash(outcome.hash)}
        </div>
      )}
    </div>
  );
}
