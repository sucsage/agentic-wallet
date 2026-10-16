"use client";

import { useEffect, useState } from "react";

import { api, type CompanyView, money, useAppData } from "./app-data";
import { Button, Card, Loading } from "./mockup-ui";
import "./company.css";

/**
 * Company accounts (C2, Napat's "Acting as · Company"): switch who you act as, register a company
 * with its signers, and move money from your wallet into it.
 */

export async function setActing(companyId: string | null) {
  await api("/api/companies/acting", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId }) });
  // Every page reads the acting account from the server: reload so nothing shows the old one.
  window.location.reload();
}

/** "Acting as" pills: yourself, or a company you belong to. */
export function ActingSwitch() {
  const { me } = useAppData();
  const [busy, setBusy] = useState<string | null>(null);
  const companies = me?.companies ?? [];
  if (!me || companies.length === 0) return null;
  const current = me.acting?.companyId ?? null;
  const pick = (id: string | null) => {
    if (id === current || busy) return;
    setBusy(id ?? "me");
    void setActing(id).catch(() => setBusy(null));
  };
  return (
    <div className="aw-acting-row">
      <small>Acting as</small>
      <div>
        <button type="button" className={`aw-acting-option${current === null ? " selected" : ""}`} onClick={() => pick(null)} disabled={busy !== null}>
          ♙ Personal · {me.user.name}
        </button>
        {companies.map((c) => (
          <button type="button" key={c.id} className={`aw-acting-option${current === c.id ? " selected" : ""}`} onClick={() => pick(c.id)} disabled={busy !== null}>
            {c.kind === "GROUP" ? "♧ Group" : "♟ Company"} · {c.name}
          </button>
        ))}
        {busy && <small>Switching…</small>}
      </div>
    </div>
  );
}

/** Moves money from the member's own wallet into the company account. */
export function FundCompany({ company, onDone, onClose }: { company: { id: string; name: string; currency: "THB" | "CNY"; kind?: "COMPANY" | "GROUP" }; onDone?: () => void; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/companies/${company.id}/fund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), requestId }),
      });
      setMsg({ ok: true, text: `Moved ${money(String(Math.round(Number(amount) * 100)), company.currency)} into ${company.name}.` });
      onDone?.();
      // Done: show the result for a moment, then close.
      setTimeout(onClose, 1200);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="aw-co-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="aw-co-dialog" role="dialog" aria-modal="true" aria-label={`Add money to ${company.name}`} onSubmit={submit}>
        <header>
          <h2>Add money to {company.name}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <p>From your own wallet. {company.kind === "GROUP" ? "Group" : "Company"} money is spent only by deals and payouts its signers approve.</p>
        <label>
          Amount ({company.currency})
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 5000" autoFocus />
        </label>
        <Button type="submit" disabled={busy || !(Number(amount) > 0) || msg?.ok === true}>
          {busy ? "Moving…" : "Move money"}
        </Button>
        {msg && <p className={msg.ok ? "aw-live-ok" : "aw-bank-error"}>{msg.text}</p>}
      </form>
    </div>
  );
}

type Contact = { userId: string; name: string; status: string };

/** Profile section: your companies, and registering a new one. */
export function CompaniesPanel() {
  const { me, refresh } = useAppData();
  const [open, setOpen] = useState(false);
  const [funding, setFunding] = useState<CompanyView | null>(null);
  const companies = (me?.companies ?? []).filter((c) => c.kind !== "GROUP");
  return (
    <Card className="aw-co-panel">
      <header>
        <h2>Company accounts</h2>
        {!open && (
          <Button variant="outline" onClick={() => setOpen(true)}>
            ＋ Register a company
          </Button>
        )}
      </header>
      <p className="aw-co-muted">
        A company has its own wallet. Its members draft deals as the company (Acting as), and money moves only after N of M signers approve.
      </p>
      {companies.length === 0 && !open && <p className="aw-co-muted">No company yet.</p>}
      {companies.map((c) => (
        <div className="aw-co-row" key={c.id}>
          <span className="aw-co-icon">♟</span>
          <span className="aw-co-name">
            <b>{c.name}</b>
            <small>
              Reg. {c.maskedTaxId} · {c.role} · {c.threshold} of {c.signers} signers approve · {c.accountNo}
            </small>
          </span>
          <strong>{money(c.balance, c.currency)}</strong>
          <span className="aw-co-actions">
            <Button variant="outline" onClick={() => setFunding(c)}>
              Add money
            </Button>
            {me?.acting?.companyId !== c.id && <Button onClick={() => void setActing(c.id)}>Act as</Button>}
          </span>
        </div>
      ))}
      {open && <CreateCompany onClose={() => setOpen(false)} onCreated={refresh} />}
      {funding && <FundCompany company={funding} onDone={() => void refresh()} onClose={() => setFunding(null)} />}
    </Card>
  );
}

function CreateCompany({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const { me } = useAppData();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [picked, setPicked] = useState<Record<string, "signer" | "member">>({});
  const [threshold, setThreshold] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ friends: Contact[] }>("/api/friends")
      .then((r) => setContacts(r.friends.filter((f) => f.status === "ACCEPTED")))
      .catch(() => setContacts([]));
  }, []);
  const signers = 1 + Object.values(picked).filter((r) => r === "signer").length;
  const th = me?.bank.currency === "CNY";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, taxId, threshold, members: Object.entries(picked).map(([userId, r]) => ({ userId, canSign: r === "signer" })) }),
      });
      await onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="aw-co-create" onSubmit={submit}>
      <label>
        Registered name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gun Studio Co., Ltd." maxLength={80} />
      </label>
      <label>
        {th ? "Unified social credit code (统一社会信用代码)" : "Juristic person id (เลขทะเบียนนิติบุคคล)"}
        <input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder={th ? "18 characters" : "13 digits, starts with 0"} maxLength={24} />
        <small>Checked by its check digit; the registry lookup is a demo. Stored masked.</small>
      </label>
      <fieldset>
        <legend>Who else is in the company (from your contacts)</legend>
        {contacts === null && <Loading text="Loading contacts…" />}
        {contacts?.length === 0 && <small>Add contacts first: they are invited and join by accepting.</small>}
        {contacts?.map((c) => (
          <div className="aw-co-pick" key={c.userId}>
            <span>{c.name}</span>
            {(["", "signer", "member"] as const).map((r) => (
              <button
                type="button"
                key={r || "none"}
                aria-pressed={(picked[c.userId] ?? "") === r}
                onClick={() =>
                  setPicked((p) => {
                    const next = { ...p };
                    if (r) next[c.userId] = r;
                    else delete next[c.userId];
                    return next;
                  })
                }
              >
                {r === "" ? "Not in it" : r === "signer" ? "Signer" : "Member (no signing)"}
              </button>
            ))}
          </div>
        ))}
      </fieldset>
      <label>
        Signers needed to approve a payment
        <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
          {Array.from({ length: Math.max(1, signers - 1) }, (_, i) => i + 2).map((n) => (
            <option key={n} value={n} disabled={n > signers}>
              {n} of {signers} signers
            </option>
          ))}
        </select>
      </label>
      <p className="aw-co-muted">You are the admin and a signer. The company gets its own wallet account (starts at 0) and agent wallet.</p>
      <div className="aw-actions">
        <Button type="submit" disabled={busy || name.trim().length < 2 || taxId.trim().length < 13 || signers < 2 || threshold > signers}>
          {busy ? "Registering and creating the wallet (about 10 s)…" : "Register company"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && <p className="aw-bank-error">{error}</p>}
    </form>
  );
}
