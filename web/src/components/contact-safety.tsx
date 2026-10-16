"use client";

import { useCallback, useEffect, useState } from "react";

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

/** Blocks someone after asking. Resolves to a message for the page. */
export async function blockPerson(person: { userId: string; name: string }): Promise<string | null> {
  if (
    !window.confirm(
      `Block ${person.name}?\n\n• They are removed from your contacts and can't add you, find you in search, send you money or invite you to a group.\n• They are taken off your allow transfer list.\n• Deals already running are not changed.\n\nYou can unblock later.`,
    )
  )
    return null;
  const r = await api<{ removedFromList: boolean }>("/api/blocks", json("POST", { userId: person.userId }));
  return `Blocked ${person.name}.${r.removedFromList ? " Also removed from your allow transfer list (on-chain)." : ""}`;
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
