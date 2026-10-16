"use client";

import { useState } from "react";

import { tokenMoney } from "./app-data";
import { Button } from "./mockup-ui";
import "./company.css";

export type Person = { userId: string; name: string };

/**
 * Send money to several people at once: tick who, then type each amount or split one total
 * equally. Used for contacts (from your own wallet) and for group payouts (after the vote).
 */
export function SendMoneyDialog({
  title,
  intro,
  people,
  currency,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  intro: string;
  people: Person[];
  currency: "THB" | "CNY";
  submitLabel: string;
  onSubmit: (recipients: { userId: string; amount: number }[]) => Promise<string>;
  onClose: () => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [split, setSplit] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const chosen = people.filter((p) => picked[p.userId]);
  const recipients = chosen.map((p) => ({ userId: p.userId, amount: Number(amounts[p.userId] || 0) }));
  const total = recipients.reduce((t, r) => t + r.amount, 0);
  const valid = recipients.length > 0 && recipients.every((r) => r.amount > 0);

  function splitEqually() {
    const t = Number(split);
    if (!(t > 0) || chosen.length === 0) return;
    // Whole satang / fen: the first people take the remainder.
    const cents = Math.round(t * 100);
    const each = Math.floor(cents / chosen.length);
    const next = { ...amounts };
    chosen.forEach((p, i) => (next[p.userId] = ((each + (i < cents - each * chosen.length ? 1 : 0)) / 100).toFixed(2)));
    setAmounts(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm(`${submitLabel}: ${tokenMoney(total, currency)} to ${chosen.map((p) => p.name).join(", ")}?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await onSubmit(recipients) });
      setTimeout(onClose, 1500);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aw-co-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="aw-co-dialog aw-send-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit}>
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <p>{intro}</p>
        {people.length === 0 && <p>No one to send to yet.</p>}
        <div className="aw-send-list">
          {people.map((p) => (
            <div className="aw-send-row" key={p.userId}>
              <label>
                <input type="checkbox" checked={!!picked[p.userId]} onChange={(e) => setPicked({ ...picked, [p.userId]: e.target.checked })} />
                <span>{p.name}</span>
              </label>
              <input
                inputMode="decimal"
                aria-label={`Amount for ${p.name}`}
                placeholder="0.00"
                disabled={!picked[p.userId]}
                value={amounts[p.userId] ?? ""}
                onChange={(e) => setAmounts({ ...amounts, [p.userId]: e.target.value.replace(/[^\d.]/g, "") })}
              />
            </div>
          ))}
        </div>
        {chosen.length > 1 && (
          <div className="aw-send-split">
            <input inputMode="decimal" placeholder="Total to split" value={split} onChange={(e) => setSplit(e.target.value.replace(/[^\d.]/g, ""))} />
            <Button type="button" variant="outline" onClick={splitEqually} disabled={!(Number(split) > 0)}>
              Split equally
            </Button>
          </div>
        )}
        <div className="aw-send-total">
          <span>
            {chosen.length} {chosen.length === 1 ? "person" : "people"}
          </span>
          <b>{tokenMoney(total, currency)}</b>
        </div>
        <Button type="submit" disabled={busy || !valid || msg?.ok === true}>
          {busy ? "Sending…" : submitLabel}
        </Button>
        {msg && <p className={msg.ok ? "aw-live-ok" : "aw-bank-error"}>{msg.text}</p>}
      </form>
    </div>
  );
}
