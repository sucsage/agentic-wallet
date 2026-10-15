"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  email: string;
  country: string;
  method: string;
  legalName: string;
  idType: string;
  maskedId: string;
  birthDate: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewer: string | null;
  note: string | null;
  createdAt: string;
};

/** The KYC reviewer's desk: approve opens the applicant's wallet, reject tells them why. */
export function KycReview() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/kyc", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) return setError(body?.error ?? `Request failed (${res.status})`);
    setRows(body.applications);
    setAuto(body.autoApprove);
    setError(null);
  }, []);
  useEffect(() => {
    // Loading the queue on mount is the point of this page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    const res = await fetch("/api/admin/kyc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, approve, note: notes[id] ?? "" }),
    });
    const body = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) return setError(body?.error ?? "Failed");
    await load();
  }

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-3">
      {auto && <p className="rounded-md border border-yellow-600/40 bg-yellow-500/10 p-2 text-xs">Demo mode: KYC_AUTO_APPROVE is on, so new applications are approved at once. Set KYC_AUTO_APPROVE=false to review them here.</p>}
      {rows.length === 0 && <p className="text-sm text-muted">No applications yet.</p>}
      {rows.map((r) => (
        <article key={r.id} className="rounded-lg border border-white/10 p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <b>
              {r.legalName} · {r.country} · {r.method}
            </b>
            <span className={r.status === "PENDING" ? "text-yellow-400" : r.status === "APPROVED" ? "text-green-400" : "text-red-400"}>{r.status}</span>
          </div>
          <p className="text-xs text-muted">
            {r.email} · {r.idType} {r.maskedId}
            {r.birthDate ? ` · born ${r.birthDate}` : ""} · {new Date(r.createdAt).toLocaleString()}
            {r.reviewer ? ` · decided by ${r.reviewer}` : ""}
            {r.note ? ` · “${r.note}”` : ""}
          </p>
          {r.status === "PENDING" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-white/15 bg-transparent px-2 py-1 text-xs"
                placeholder="Note (required to reject; the applicant sees it)"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
              />
              <button type="button" disabled={busy === r.id} className="rounded-md border border-red-400/50 px-3 py-1 text-xs" onClick={() => void decide(r.id, false)}>
                Reject
              </button>
              <button type="button" disabled={busy === r.id} className="rounded-md bg-green-600 px-3 py-1 text-xs text-white" onClick={() => void decide(r.id, true)}>
                Approve & open wallet
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
