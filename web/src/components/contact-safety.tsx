"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "./header-tools";
import { api } from "./app-data";
import { Button } from "./mockup-ui";
import "./company.css";

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const REASONS = [
  ["SCAM", "Scam or fraud (asked for money, fake payment slip…)"],
  ["NOT_DELIVERED", "Took payment / deal but did not deliver"],
  ["IMPERSONATION", "Pretending to be someone else"],
  ["HARASSMENT", "Harassment or threats"],
  ["SPAM", "Spam"],
  ["OTHER", "Something else"],
] as const;

/** The Block confirmation, with progress while it runs (it may update the allow transfer list on-chain). */
export function BlockDialog({ person, onClose, onDone }: { person: { userId: string; name: string }; onClose: () => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function block() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ removedFromList: boolean }>("/api/blocks", json("POST", { userId: person.userId }));
      toast({ text: `Blocked ${person.name}`, tone: "ok" });
      onDone(`Blocked ${person.name}.${r.removedFromList ? " Also removed from your allow transfer list (on-chain)." : ""}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="aw-co-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="aw-co-dialog aw-report-dialog" role="dialog" aria-modal="true" aria-label={`Block ${person.name}`}>
        <header>
          <h2>⦸ Block {person.name}?</h2>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy}>
            ×
          </button>
        </header>
        <ul className="aw-block-effects">
          <li>Removed from your contacts; they can&apos;t add you or find you in search</li>
          <li>Neither of you can send the other money or group invites</li>
          <li>Taken off your allow transfer list (an on-chain update, a few seconds)</li>
          <li>Deals already running are not changed. You can unblock later.</li>
        </ul>
        {busy && (
          <div className="aw-draft-busy" role="status" aria-live="polite">
            <i className="aw-spinner" aria-hidden />
            <span>Blocking and updating your allow transfer list…</span>
          </div>
        )}
        {error && <p className="aw-bank-error">{error}</p>}
        <footer className="aw-dialog-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" className="aw-danger" onClick={() => void block()} disabled={busy} aria-busy={busy}>
            {busy ? (
              <>
                <i className="aw-spinner" aria-hidden /> Blocking…
              </>
            ) : (
              `Block ${person.name}`
            )}
          </Button>
        </footer>
      </div>
    </div>
  );
}

/** The Report form, for one contact. */
export function ReportDialog({ person, onClose, onDone }: { person: { userId: string; name: string }; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("SCAM");
  const [details, setDetails] = useState("");
  const [block, setBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ blocked: boolean }>("/api/reports", json("POST", { userId: person.userId, reason, details, block }));
      toast({ text: `Report about ${person.name} sent`, tone: "ok" });
      onDone(`Reported ${person.name}. The app's reviewers will look at it; they won't tell them who reported.${r.blocked ? ` ${person.name} is also blocked.` : ""}`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aw-co-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="aw-co-dialog aw-report-dialog" role="dialog" aria-modal="true" aria-label={`Report ${person.name}`} onSubmit={submit}>
        <header>
          <h2>Report {person.name}</h2>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy}>
            ×
          </button>
        </header>
        <p>What happened? Reports go to the app&apos;s reviewers. If money is involved in a running deal, open a dispute on the deal&apos;s page as well: that is what can hold or return the money.</p>
        <fieldset className="aw-report-reasons">
          <legend>Reason</legend>
          {REASONS.map(([k, label]) => (
            <label key={k}>
              <input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <label className="aw-report-details">
          <span>Details (optional)</span>
          <textarea rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Dates, deal numbers (D-12), what was said…" />
        </label>
        <label className="aw-report-block">
          <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} />
          <span>Also block {person.name}</span>
        </label>
        {error && <p className="aw-bank-error">{error}</p>}
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send report"}
        </Button>
      </form>
    </div>
  );
}

/** People the user blocked, with Unblock. */
export function BlockedPanel({ version, onChange }: { version: number; onChange: (msg: string) => void }) {
  const [list, setList] = useState<{ userId: string; name: string; username: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ blocked: { userId: string; name: string; username: string }[] }>("/api/blocks")
      .then((r) => setList(r.blocked))
      .catch(() => setList([]));
  }, []);
  useEffect(() => {
    load();
  }, [load, version]);
  if (!list || list.length === 0) return null;
  return (
    <section className="aw-friends-panel aw-blocked-panel">
      <header>
        <h2>Blocked</h2>
        <span>{list.length}</span>
      </header>
      {list.map((b) => (
        <div className="aw-request-row" key={b.userId}>
          <span className="aw-friend-avatar">⦸</span>
          <span className="aw-friend-name">
            <b>{b.name}</b>
            <small>@{b.username}</small>
          </span>
          <div>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={async () => {
                setBusy(b.userId);
                try {
                  await api(`/api/blocks/${b.userId}`, json("DELETE"));
                  onChange(`Unblocked ${b.name}. Add them again from search if you want them back as a contact.`);
                  load();
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === b.userId ? "Unblocking…" : "Unblock"}
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
