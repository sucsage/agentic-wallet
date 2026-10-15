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
};

export function DisputeReview() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

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

  async function rule(id: string, toSeller: boolean) {
    setBusy(id);
    const res = await fetch("/api/admin/disputes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, toSeller, note: notes[id] ?? "" }),
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
              <b>AI recommends:</b> {r.decision === "seller" ? "pay the seller" : "refund the buyer"}
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
          <a className="text-xs underline" href={`/deal/D-${r.dealId}`}>
            Open the deal (as a party) ↗
          </a>
          <textarea
            className="rounded-md border border-border bg-surface p-2 text-xs"
            placeholder="Your reasoning (recorded with the ruling, at least 10 characters)"
            value={notes[r.id] ?? ""}
            onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
          />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy !== null || (notes[r.id] ?? "").trim().length < 10} onClick={() => rule(r.id, true)}>
              Pay the seller
            </button>
            <button className="btn-primary" disabled={busy !== null || (notes[r.id] ?? "").trim().length < 10} onClick={() => rule(r.id, false)}>
              Refund the buyer
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
