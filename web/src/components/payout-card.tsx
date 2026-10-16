"use client";

import { useState } from "react";

import { api, tokenMoney } from "./app-data";
import { Button } from "./mockup-ui";

export type PayoutPreview = {
  groupId: string;
  group: string;
  threshold: number;
  reason: string;
  recipients: { userId: string; name: string; amount: number }[];
};

/**
 * The AI's proposal to pay people from a group's / company's account. Nothing happens until the
 * user confirms; then it goes to the signers' vote (the user's yes counts if they sign).
 */
export function PayoutCard({ p, currency, canConfirm = true }: { p: PayoutPreview; currency: "THB" | "CNY"; canConfirm?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "gone">("idle");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const total = p.recipients.reduce((t, r) => t + r.amount, 0);
  async function confirm() {
    setState("busy");
    setMsg(null);
    try {
      const r = await api<{ status: string; yes: number }>(`/api/groups/${p.groupId}/payouts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipients: p.recipients.map((x) => ({ userId: x.userId, amount: x.amount })) }),
      });
      setState("done");
      setMsg({
        ok: true,
        text: r.status === "EXECUTED" ? "Approved and paid." : `Put to ${p.group}'s vote: ${r.yes} of ${p.threshold} yes so far. Signers vote on the group's page; it is paid when ${p.threshold} approve.`,
      });
    } catch (e) {
      setState("idle");
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  return (
    <section className="aw-deal-draft aw-payout-card">
      <div className="aw-draft-topline">
        <small>PAYMENT FROM {p.group.toUpperCase()}</small>
        <span>{state === "done" ? "In the vote" : state === "gone" ? "Discarded" : `Preview · needs ${p.threshold} signers`}</span>
      </div>
      <h2>{p.reason || "Payment"}</h2>
      {p.recipients.map((r) => (
        <div className="aw-draft-milestone" key={r.userId}>
          <i>→</i>
          <span>
            <b>{r.name}</b>
          </span>
          <strong>{tokenMoney(r.amount, currency)}</strong>
        </div>
      ))}
      <div className="aw-draft-total">
        <span>Total from the {p.group} account</span>
        <b>{tokenMoney(total, currency)}</b>
      </div>
      <div className="aw-draft-notice">ⓘ &nbsp;A direct payment, not a deal: nothing is held in escrow. Confirming puts it to the signers&apos; vote; the money moves only when {p.threshold} approve.</div>
      {state !== "done" && state !== "gone" && canConfirm && (
        <div className="aw-draft-actions">
          <Button variant="outline" onClick={() => setState("gone")} disabled={state === "busy"}>
            Discard
          </Button>
          <Button onClick={() => void confirm()} disabled={state === "busy"}>
            {state === "busy" ? "…" : `Confirm · put to the vote · ${tokenMoney(total, currency)}`}
          </Button>
        </div>
      )}
      {!canConfirm && state === "idle" && <small>Only the member who asked can confirm it.</small>}
      {msg && <p className={msg.ok ? "aw-live-ok" : "aw-bank-error"}>{msg.text}</p>}
    </section>
  );
}
