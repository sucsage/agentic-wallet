"use client";

import { useCallback, useEffect, useState } from "react";

type Report = { id: string; reason: string; details: string; createdAt: string; reporter: string; reported: { id: string; name: string; reports: number } };

/** Admins: user reports from Contacts. Closing one marks it reviewed. */
export function ReportReview() {
  const [rows, setRows] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/reports", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) return setError(body?.error ?? `Request failed (${res.status})`);
    setRows(body.reports);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function close(id: string) {
    await fetch("/api/admin/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    await load();
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted">No open reports.</p>;
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <article key={r.id} className="card flex flex-col gap-1 p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <b>
              {r.reported.name} <span className="text-muted">· {r.reported.reports} report(s) in total</span>
            </b>
            <span className="pill">{r.reason}</span>
          </div>
          <small className="text-muted">
            From {r.reporter} · {new Date(r.createdAt).toLocaleString()}
          </small>
          {r.details && <p className="whitespace-pre-wrap">{r.details}</p>}
          <div>
            <button className="btn-ghost h-8" onClick={() => void close(r.id)}>
              Mark reviewed
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
