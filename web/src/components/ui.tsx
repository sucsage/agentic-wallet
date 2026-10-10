"use client";

import type { ActionResult } from "@/lib/actions";
import { trServer, useT } from "@/lib/i18n";
import type { AuditEntry, WalletState } from "@/lib/state";

export type Workspace = WalletState & { audit: AuditEntry[]; model: string | null };

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function fmt(n: string | number) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function Tier({ route, tier }: { route: string; tier: number }) {
  const { t } = useT();
  const tone =
    route === "execute"
      ? "bg-ok-soft text-ok"
      : route === "propose"
        ? "bg-warn-soft text-warn"
        : "bg-bad-soft text-bad";
  const label = route === "execute" ? t("route.execute") : route === "propose" ? t("route.propose") : t("route.block");
  return (
    <span className={`pill ${tone}`}>
      Tier {tier} · {label}
    </span>
  );
}

export function TxLink({ hash, url }: { hash: string; url: string | null }) {
  return url ? (
    <a className="font-mono text-xs text-accent underline-offset-2 hover:underline" href={url} target="_blank" rel="noreferrer">
      {short(hash)} ↗
    </a>
  ) : (
    <span className="font-mono text-xs text-muted" title={hash}>
      {short(hash)}
    </span>
  );
}

/** Compact rendering of an action's policy decision and on-chain outcome. */
export function Outcome({ result }: { result: ActionResult }) {
  const { t, lang } = useT();
  const o = result.outcome;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {result.decision && <Tier route={result.decision.route} tier={result.decision.tier} />}
        {o?.status === "success" && (
          <span className="pill bg-ok-soft text-ok">
            {t("outcome.confirmed")} <TxLink hash={o.hash} url={o.url} />
          </span>
        )}
        {o?.status === "reverted" && (
          <span className="pill bg-bad-soft text-bad">
            {t("outcome.reverted")} {o.error} <TxLink hash={o.hash} url={o.url} />
          </span>
        )}
        {o?.status === "rejected" && (
          <span className="pill bg-bad-soft text-bad">
            {t("outcome.rejected")} {o.error}
          </span>
        )}
      </div>
      {result.decision && (
        <p className="text-xs text-muted">{result.decision.reasons.map((r) => trServer(r, lang)).join(" · ")}</p>
      )}
      {result.detail && <p className="text-xs text-muted">{trServer(result.detail, lang)}</p>}
    </div>
  );
}

export async function postAction(address: string, body: Record<string, unknown>): Promise<ActionResult> {
  const res = await fetch(`/api/workspace/${address}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Action failed");
  return json;
}
