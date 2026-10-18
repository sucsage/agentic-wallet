"use client";

import { type FormEvent, useState } from "react";

export type Guarantor = { name: string; contact: string; relation: string; amount: number | null };

/**
 * Name a guarantor (ผู้ค้ำประกัน) for your side of a deal: name, phone or email, relation, and the most
 * they answer for (empty: your whole obligation). `save` sends it; plain markup so it fits both the app
 * and the private-link pages.
 */
export function GuarantorForm({
  current,
  required,
  currency,
  save,
  remove,
  className = "",
}: {
  current: Guarantor | null;
  required: boolean;
  currency: "THB" | "CNY";
  save: (g: Guarantor) => Promise<void>;
  remove?: () => Promise<void>;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ name: current?.name ?? "", contact: current?.contact ?? "", relation: current?.relation ?? "", amount: current?.amount ? String(current.amount) : "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sign = currency === "THB" ? "฿" : "¥";
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await save({ name: v.name.trim(), contact: v.contact.trim(), relation: v.relation.trim(), amount: v.amount.trim() ? Number(v.amount.replace(/[^\d.]/g, "")) : null });
      setEditing(false);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`aw-guarantor ${className}`}>
      <div className="aw-guarantor-head">
        <b>Your guarantor · ผู้ค้ำประกัน</b>
        {required && !current && <span className="aw-guarantor-req">Required before you sign</span>}
      </div>
      {!editing ? (
        <div className="aw-guarantor-value">
          {current ? (
            <span>
              <b>{current.name}</b> · {current.relation} · {current.contact} · {current.amount ? `up to ${sign}${current.amount.toLocaleString("en-US")}` : "your whole obligation"}
            </span>
          ) : (
            <small>{required ? "This deal asks for a guarantor from your side." : "None (optional)."}</small>
          )}
          <button type="button" onClick={() => setEditing(true)} disabled={busy}>
            {current ? "Change" : "+ Add"}
          </button>
          {current && remove && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await remove();
                } catch (e2) {
                  setErr((e2 as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="aw-guarantor-form">
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Full name" required minLength={2} maxLength={120} />
          <input value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} placeholder="Phone or email" required minLength={5} maxLength={160} />
          <input value={v.relation} onChange={(e) => setV({ ...v, relation: e.target.value })} placeholder="Relation (e.g. parent, business partner)" required minLength={2} maxLength={80} />
          <input value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} inputMode="decimal" placeholder={`Up to (${sign}, empty = whole obligation)`} />
          <div>
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          <small>No ID card number: the name, a contact and the relation go on the contract with a guarantee clause.</small>
        </form>
      )}
      {err && <p className="aw-guarantor-err">{err}</p>}
    </div>
  );
}
