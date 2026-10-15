"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  dealId: number;
  index: number;
  title: string | null;
  phase: string;
  reason: string;
  status: string;
  decision: string | null;
  confidence: number | null;
  rationale: string | null;
  findings: { criterion: string; met: boolean; evidence: string }[] | null;
  stage?: string;
  sellerStatement?: string | null;
  proposal?: Vote | null;
  panel?: Vote[] | null;
  appeal?: Vote[] | null;
};
type Vote = { model: string; sellerBps?: number; rationale?: string; failed?: true };

/** Each model's ruling: the seller's share and why (or that it gave no valid answer). */
function Votes({ title, votes }: { title: string; votes: Vote[] }) {
  return (
    <div className="text-xs">
      <b>{title}</b>
      <ul className="list-disc pl-5">
        {votes.map((v, i) => (
          <li key={i}>
            {v.model}: {v.failed ? "no valid ruling" : `seller ${(v.sellerBps ?? 0) / 100}% · ${v.rationale}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DisputeReview() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // The seller's share the arbiter will rule, per dispute (percent).
  const [share, setShare] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/disputes", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) return setError(body?.error ?? `Request failed (${res.status})`);
    setRows(body.disputes);
    setError(null);
  }, []);

  useEffect(() => {
    // Loading the list on mount is the point of this page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function rule(id: string, sellerPercent: number) {
    setBusy(id);
    const res = await fetch("/api/admin/disputes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, sellerBps: Math.round(sellerPercent * 100), note: notes[id] ?? "" }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.outcome?.status !== "success") setError(body?.error ?? body?.outcome?.error ?? "Resolve failed");
    setBusy(null);
    await load();
  }

  if (error) return <p className="card p-4 text-sm text-bad">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  if (rows.length === 0) return <p className="card p-4 text-sm">No disputes waiting for a human.</p>;
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <section key={r.id} className="card flex flex-col gap-2 p-4 text-sm">
          <h2 className="font-semibold">
            Deal D-{r.dealId} · milestone {r.index + 1} {r.title ? `· ${r.title}` : ""} <span className="text-xs text-muted">({r.status})</span>
          </h2>
          <p>
            <b>Buyer&apos;s reason:</b> {r.reason}
          </p>
          {r.decision && (
            <p>
              <b>AI recommends:</b> {r.decision === "seller" ? "pay the seller" : r.decision === "split" ? "split" : "refund the buyer"}
              {r.confidence !== null && ` (${Math.round(r.confidence * 100)}% confident)`} · {r.rationale}
            </p>
          )}
          {!r.decision && r.rationale && <p className="text-muted">{r.rationale}</p>}
          {r.findings && (
            <ul className="list-disc pl-5 text-xs">
              {r.findings.map((f, i) => (
                <li key={i}>
                  {f.met ? "✓" : "✗"} {f.criterion}: {f.evidence}
                </li>
              ))}
            </ul>
          )}
          {r.sellerStatement && (
            <p>
              <b>Seller&apos;s reply:</b> {r.sellerStatement}
            </p>
          )}
          {r.proposal && <Votes title="Mediator's proposal" votes={[r.proposal]} />}
          {r.panel && <Votes title="Panel · 3 models (2 of 3 must agree)" votes={r.panel} />}
          {r.appeal && <Votes title="Appeal · 5 models (3 of 5 must agree)" votes={r.appeal} />}
          <a className="text-xs underline" href={`/deals/D-${r.dealId}`}>
            Open the deal (as a party) ↗
          </a>
          <textarea
            className="rounded-md border border-border bg-surface p-2 text-xs"
            placeholder="Your reasoning (recorded with the ruling, at least 10 characters)"
            value={notes[r.id] ?? ""}
            onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
          />
          <label className="flex items-center gap-2 text-xs">
            Seller gets
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={share[r.id] ?? 50}
              onChange={(e) => setShare({ ...share, [r.id]: Number(e.target.value) })}
            />
            <b>{share[r.id] ?? 50}%</b> · buyer gets {100 - (share[r.id] ?? 50)}% back
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy !== null || (notes[r.id] ?? "").trim().length < 10} onClick={() => rule(r.id, share[r.id] ?? 50)}>
              Rule this split
            </button>
            <button className="btn-primary" disabled={busy !== null || (notes[r.id] ?? "").trim().length < 10} onClick={() => rule(r.id, 100)}>
              Pay the seller
            </button>
            <button className="btn-primary" disabled={busy !== null || (notes[r.id] ?? "").trim().length < 10} onClick={() => rule(r.id, 0)}>
              Refund the buyer
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
