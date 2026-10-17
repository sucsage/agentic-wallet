"use client";

import { useState } from "react";

import { api } from "./app-data";
import { Button } from "./mockup-ui";

const DEVICES = {
  desktop: { label: "Desktop", w: 1280, h: 800 },
  tablet: { label: "Tablet", w: 820, h: 1100 },
  phone: { label: "Phone", w: 390, h: 780 },
} as const;
type Device = keyof typeof DEVICES;

/**
 * A delivered web page tried in a device mockup (browser window, tablet or phone). The page is
 * served sandboxed by the server and framed here, scaled to fit the card.
 */
export function SiteMockup({ src, name }: { src: string; name: string }) {
  const [device, setDevice] = useState<Device>("desktop");
  const [open, setOpen] = useState(false);
  const d = DEVICES[device];
  const box = device === "desktop" ? 560 : device === "tablet" ? 300 : 220;
  const scale = box / d.w;
  return (
    <div className="aw-site-mockup">
      <div className="aw-site-tools">
        <b>🖥 Live mockup preview</b>
        <span>
          {(Object.keys(DEVICES) as Device[]).map((k) => (
            <button key={k} type="button" className={k === device ? "active" : ""} onClick={() => setDevice(k)}>
              {DEVICES[k].label}
            </button>
          ))}
          <button type="button" onClick={() => setOpen(true)}>
            ⤢ Full screen
          </button>
        </span>
      </div>
      <div className={`aw-device ${device}`} style={{ width: d.w * scale + (device === "desktop" ? 0 : 20) }}>
        {device === "desktop" && (
          <div className="aw-device-chrome">
            <i />
            <i />
            <i />
            <span>{name}</span>
          </div>
        )}
        <div className="aw-device-screen" style={{ width: d.w * scale, height: d.h * scale }}>
          <iframe title={`Preview of ${name}`} src={src} sandbox="allow-scripts allow-forms" style={{ width: d.w, height: d.h, transform: `scale(${scale})` }} />
        </div>
      </div>
      <small>Sandboxed preview of the delivered page (scripts run, but it cannot reach your account). The file itself unlocks after you approve.</small>
      {open && (
        <div className="aw-site-full" role="dialog" aria-modal="true" aria-label={`Full screen preview of ${name}`}>
          <header>
            <b>{name}</b>
            <span>
              {(Object.keys(DEVICES) as Device[]).map((k) => (
                <button key={k} type="button" className={k === device ? "active" : ""} onClick={() => setDevice(k)}>
                  {DEVICES[k].label}
                </button>
              ))}
              <button type="button" onClick={() => setOpen(false)}>
                ✕ Close
              </button>
            </span>
          </header>
          <iframe title={`Full preview of ${name}`} src={src} sandbox="allow-scripts allow-forms" style={{ width: device === "desktop" ? "100%" : d.w, height: "100%" }} />
        </div>
      )}
    </div>
  );
}

const DOCS = [
  ["contract", "📄 Contract", "สัญญา"],
  ["request", "🧾 Payment request", "ใบเบิกเงิน"],
  ["receipt", "✓ Receipt", "ใบเสร็จ"],
  ["tax", "🏛 Tax invoice", "ใบกำกับภาษี"],
] as const;

/** Export buttons: each opens a printable page (Print / Save as PDF). */
export function DealDocuments({ dealId, milestones }: { dealId: number; milestones: { status: string; split?: unknown }[] }) {
  const paid = milestones.some((m) => m.status === "Released" || m.status === "Split");
  const payable = milestones.some((m) => ["Delivered", "Approved", "KeyReleased"].includes(m.status));
  const ok = { contract: true, request: payable, receipt: paid, tax: paid };
  return (
    <section className="aw-deal-docs">
      <b>Export documents</b>
      <div>
        {DOCS.map(([type, label, th]) => (
          <a
            key={type}
            className={`aw-doc-btn${ok[type] ? "" : " off"}`}
            href={ok[type] ? `/api/deals/${dealId}/document?type=${type}` : undefined}
            target="_blank"
            rel="noopener"
            aria-disabled={!ok[type]}
            title={ok[type] ? `Open the ${th} to print or save as PDF` : type === "request" ? "After a delivery" : "After a milestone is paid"}
          >
            {label}
            <small>{th}</small>
          </a>
        ))}
      </div>
      <small>Opens a printable page: use Print → Save as PDF. Demo documents (test money).</small>
    </section>
  );
}

/** Each side may name one witness for the contract (optional). */
export function WitnessPanel({
  dealId,
  role,
  witnesses,
  onDone,
}: {
  dealId: number;
  role: "buyer" | "seller";
  witnesses: { side: string; name: string; contact: string; mine: boolean }[];
  onDone: () => void;
}) {
  const mine = witnesses.find((w) => w.mine);
  const theirs = witnesses.find((w) => !w.mine);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(mine?.name ?? "");
  const [contact, setContact] = useState(mine?.contact ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(remove = false) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/deals/${dealId}/witness`, remove ? { method: "DELETE" } : { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, contact }) });
      setEditing(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="aw-witnesses">
      <b>
        Witnesses <small>(optional · shown on the contract)</small>
      </b>
      <div className="aw-witness-row">
        <span>Your witness ({role})</span>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" maxLength={120} required minLength={2} />
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone or email (optional)" maxLength={160} />
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <span className="aw-witness-value">
            {mine ? (
              <>
                <b>{mine.name}</b>
                {mine.contact && <small> · {mine.contact}</small>}
              </>
            ) : (
              <small>None</small>
            )}
            <button type="button" onClick={() => setEditing(true)} disabled={busy}>
              {mine ? "Change" : "+ Add"}
            </button>
            {mine && (
              <button type="button" onClick={() => void save(true)} disabled={busy}>
                Remove
              </button>
            )}
          </span>
        )}
      </div>
      <div className="aw-witness-row">
        <span>Their witness</span>
        <span className="aw-witness-value">{theirs ? <b>{theirs.name}</b> : <small>None</small>}</span>
      </div>
      {error && <p className="aw-bank-error">{error}</p>}
    </section>
  );
}
