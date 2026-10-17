"use client";

import { useState } from "react";

import { localizeMockupNode, useLang } from "@/lib/i18n";

import { api, tokenMoney } from "./app-data";
import { toast } from "./header-tools";
import { Button } from "./mockup-ui";

export type PlanViewData = {
  id: string | null;
  status: string;
  paidParts: number;
  parts: { amount: string; due: string; paid: boolean; late: boolean }[];
  paid: number;
  total: number;
};

/**
 * A split payment (แบ่งจ่าย): every part with its due date, what is paid, and the buttons for the
 * buyer (pay the next part, stop and get the money back). Nothing is delivered before the last part.
 */
export function PlanCard({
  plan,
  currency,
  payer,
  onStart,
  onChanged,
}: {
  plan: PlanViewData;
  currency: "THB" | "CNY";
  /** The buyer (who pays the parts) sees the buttons; the seller sees the progress. */
  payer: boolean;
  /** For a seller's offer the buyer starts the plan (part 1). */
  onStart?: () => Promise<void>;
  onChanged: () => Promise<void> | void;
}) {
  const lang = useLang();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const next = plan.parts.find((p) => !p.paid);
  const allPaid = plan.parts.every((p) => p.paid);
  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      toast({ text: ok, tone: "ok" });
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const post = (path: string, body: object = {}) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const active = plan.status === "ACTIVE";
  return localizeMockupNode(
    <section className="aw-plan">
      <header>
        <b>Split payment · แบ่งจ่าย</b>
        <span className={`aw-plan-status ${plan.status.toLowerCase()}`}>
          {plan.status === "NOT_STARTED"
            ? "Not started"
            : plan.status === "ACTIVE"
              ? `${plan.paidParts} of ${plan.parts.length} paid`
              : plan.status === "COMPLETE"
                ? "Paid in full · locked"
                : plan.status === "LAPSED"
                  ? "Ended: a part was late · refunded"
                  : "Cancelled · refunded"}
        </span>
      </header>
      <ol>
        {plan.parts.map((p, i) => (
          <li key={i} className={p.paid ? "paid" : p.late && active ? "late" : ""}>
            <span>
              Part {i + 1} · due {new Date(`${p.due}T00:00:00`).toLocaleDateString()}
            </span>
            <b>{tokenMoney(Number(p.amount), currency)}</b>
            <small>{p.paid ? "✓ paid" : p.late && active ? "late" : ""}</small>
          </li>
        ))}
      </ol>
      <div className="aw-plan-bar" aria-hidden>
        <i style={{ width: `${plan.total ? Math.round((plan.paid / plan.total) * 100) : 0}%` }} />
      </div>
      <small className="aw-plan-note">
        Paid {tokenMoney(plan.paid, currency)} of {tokenMoney(plan.total, currency)}. The parts wait in a holding account: nothing is locked in escrow or delivered until every part is paid. A part more than 7 days late ends the plan and returns what was paid.
      </small>
      {payer && (
        <div className="aw-plan-actions">
          {plan.status === "NOT_STARTED" && onStart && (
            <Button disabled={!!busy} onClick={() => void run("start", onStart, "Part 1 paid")}>
              {busy === "start" ? "Paying…" : `Start · pay part 1 (${tokenMoney(Number(plan.parts[0].amount), currency)})`}
            </Button>
          )}
          {active && next && plan.id && (
            <Button disabled={!!busy} onClick={() => void run("pay", () => post(`/api/plans/${plan.id}/pay`), plan.paidParts + 1 === plan.parts.length ? "Paid in full: locked in escrow" : `Part ${plan.paidParts + 1} paid`)}>
              {busy === "pay"
                ? "Paying…"
                : plan.paidParts + 1 === plan.parts.length
                  ? `Pay the last part (${tokenMoney(Number(next.amount), currency)}) & lock`
                  : `Pay part ${plan.paidParts + 1} now (${tokenMoney(Number(next.amount), currency)})`}
            </Button>
          )}
          {active && allPaid && plan.id && (
            <Button disabled={!!busy} onClick={() => void run("lock", () => post(`/api/plans/${plan.id}/pay`, { lock: true }), "Locked in escrow")}>
              {busy === "lock" ? "Locking…" : "Lock now"}
            </Button>
          )}
          {active && plan.id && (
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => {
                if (!window.confirm("Stop the split payment? Everything paid so far comes back to your balance.")) return;
                void run("cancel", () => post(`/api/plans/${plan.id}/cancel`), "Split payment stopped: refunded");
              }}
            >
              {busy === "cancel" ? "…" : "Stop & get my money back"}
            </Button>
          )}
        </div>
      )}
      {err && <p className="aw-bank-error">{err}</p>}
    </section>,
    lang,
  );
}

/** The card's data from a draft's agreed parts and its plan's progress. */
export function planFromParts(parts: { amount: string; due: string }[], plan: { id: string; status: string; paidParts: number } | null): PlanViewData {
  const today = new Date().toISOString().slice(0, 10);
  const paidParts = plan?.paidParts ?? 0;
  return {
    id: plan?.id ?? null,
    status: plan?.status ?? "NOT_STARTED",
    paidParts,
    parts: parts.map((p, i) => ({ ...p, paid: paidParts > i, late: paidParts <= i && p.due < today })),
    paid: parts.slice(0, paidParts).reduce((t, p) => t + Number(p.amount), 0),
    total: parts.reduce((t, p) => t + Number(p.amount), 0),
  };
}
