"use client";

import { type CSSProperties, useState } from "react";
import { askConfirm } from "./ui-dialog";

export type Due = { index: number; due: string | null; proposedDue: string | null; proposedBy: "me" | "them" | null; late: boolean; lateRequestedAt: string | null };

const box: CSSProperties = { display: "grid", gap: 6, marginTop: 8, padding: "8px 10px", border: "1px solid #2e2e2e", borderRadius: 10, fontSize: 12.5 };
const btn: CSSProperties = { border: "1px solid #444", background: "transparent", color: "inherit", borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer" };
const primary: CSSProperties = { ...btn, background: "#fff", color: "#111", borderColor: "#fff", fontWeight: 600 };
const input: CSSProperties = { border: "1px solid #333", background: "#0c0c0c", color: "inherit", borderRadius: 8, padding: "3px 8px", fontSize: 12 };

const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
function left(d: string) {
  const days = Math.ceil((new Date(`${d}T23:59:59+07:00`).getTime() - Date.now()) / 86_400_000);
  return days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : days === 0 ? "today" : `late by ${-days} day${days === -1 ? "" : "s"}`;
}

/**
 * A milestone's delivery due date, agreed by both sides: see it with a countdown, propose a date,
 * accept the other side's, and (the buyer, when nothing came by the date) ask for a refund.
 */
export function DueControl({ due, role, editable, onAction }: { due: Due | null; role: "buyer" | "seller"; editable: boolean; onAction: (action: "propose" | "accept" | "late", date?: string) => Promise<void> }) {
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Today in Bangkok, read once (the date picker's earliest day).
  const [today] = useState(() => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10));
  if (!due) return null;
  const run = async (action: "propose" | "accept" | "late", d?: string) => {
    setBusy(true);
    setErr(null);
    try {
      await onAction(action, d);
      setDate("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ ...box, borderColor: due.late ? "#5a2a2e" : "#2e2e2e" }}>
      <span>
        <b>Due:</b>{" "}
        {due.due ? (
          <span style={{ color: due.late ? "#ff6b6b" : undefined }}>
            {fmt(due.due)}
            {editable ? ` · ${left(due.due)}` : ""}
          </span>
        ) : (
          <span style={{ opacity: 0.75 }}>no date agreed</span>
        )}
      </span>
      {due.proposedDue && due.proposedBy === "them" && (
        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          They propose {fmt(due.proposedDue)}.
          {editable && (
            <button type="button" style={primary} disabled={busy} onClick={() => void run("accept")}>
              Accept {fmt(due.proposedDue)}
            </button>
          )}
        </span>
      )}
      {due.proposedDue && due.proposedBy === "me" && <span style={{ opacity: 0.8 }}>You proposed {fmt(due.proposedDue)}: waiting for them to accept.</span>}
      {editable && (
        <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" style={input} min={today} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Due date" />
          <button type="button" style={btn} disabled={busy || !date} onClick={() => void run("propose", date)}>
            {due.due ? "Propose another date" : "Propose a due date"}
          </button>
        </span>
      )}
      {due.late && role === "buyer" && !due.lateRequestedAt && (
        <button type="button" style={{ ...btn, color: "#ff8a8a", borderColor: "#5a2a2e", justifySelf: "start" }} disabled={busy} onClick={async () => (await askConfirm("Nothing was delivered by the agreed date. Ask the seller to refund this milestone?")) && void run("late")}>
          Ask for this milestone&apos;s money back (late)
        </button>
      )}
      {due.lateRequestedAt && (
        <span style={{ color: "#ff8a8a" }}>
          {role === "buyer" ? "You asked for a refund" : "The buyer asks for a refund: nothing was delivered by the agreed date. Refund this milestone, or deliver and talk to them."}{" "}
          ({new Date(due.lateRequestedAt).toLocaleDateString()})
        </span>
      )}
      {err && <span style={{ color: "#ff8a8a" }}>{err}</span>}
    </div>
  );
}
