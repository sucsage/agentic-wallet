"use client";

import { useState, type FormEvent } from "react";

import { Button } from "./mockup-ui";
import "./pre-draft-deal.css";

/**
 * "Before I draft the deal" (Napat's pre-draft form, wired to the agent): when the agent calls
 * ask_deal_details, the chat shows what it already knows and a field for each missing detail.
 * Submitting sends the answers back to the agent as the user's next message.
 */

export type DealFormData = {
  side: "buy" | "sell";
  known: { counterparty?: string; kind?: string; work?: string; price?: string; milestones?: string; acceptance?: string; ship_to?: string; file_types?: string; deposit?: string };
  missing: ("counterparty" | "kind" | "work" | "price" | "milestones" | "deadline" | "acceptance" | "ship_to" | "file_types" | "deposit")[];
  contacts: string[];
};

const LABEL: Record<string, string> = {
  counterparty: "Who is it with?",
  kind: "What kind of deal?",
  work: "What is delivered?",
  price: "Price",
  milestones: "How is it paid?",
  deadline: "Deadline",
  acceptance: "What counts as done?",
  ship_to: "Delivery address",
  file_types: "Which file formats do you accept?",
  deposit: "A deposit on signing?",
};
const KNOWN: Record<string, string> = {
  counterparty: "With",
  kind: "Type",
  work: "Work",
  price: "Price",
  milestones: "Paid in",
  acceptance: "Done when",
  ship_to: "Ship to",
  file_types: "Files",
  deposit: "Deposit",
};
const FORMATS = ["PDF", "PNG", "JPG", "SVG", "AI", "PSD", "FIG", "DWG", "ZIP", "DOCX", "XLSX", "MP4", "HTML"];

export function DealFormCard({ form, currency, disabled, onSubmit }: { form: DealFormData; currency: "THB" | "CNY"; disabled?: boolean; onSubmit: (text: string) => void }) {
  const [v, setV] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const set = (k: string, value: string) => setV((cur) => ({ ...cur, [k]: value }));
  const listOf = (x: string | undefined) => (x ?? "").split(/,\s*/).filter(Boolean);
  const formats = listOf(v.file_types);
  const toggleFormat = (f: string) =>
    setV((cur) => {
      const now = listOf(cur.file_types);
      return { ...cur, file_types: (now.includes(f) ? now.filter((x) => x !== f) : [...now, f]).join(", ") };
    });
  const [addressNote, setAddressNote] = useState<string | null>(null);
  async function fillSavedAddress() {
    setAddressNote(null);
    try {
      const r = await fetch("/api/profile/address", { cache: "no-store" }).then((x) => x.json());
      if (r?.text) set("ship_to", r.text);
      else setAddressNote("No address saved yet: add one on Profile & Privacy, or type it here.");
    } catch {
      setAddressNote("Could not read your saved address.");
    }
  }
  const missing = form.missing.filter((k) => !(v[k] ?? "").trim()).length;
  const sign = currency === "THB" ? "฿" : "¥";
  const choice = (k: string, options: [string, string][]) => (
    <div className="aw-predraft-options">
      {options.map(([value, label]) => (
        <button type="button" key={value} aria-pressed={v[k] === value} onClick={() => set(k, value)}>
          {label}
        </button>
      ))}
    </div>
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    if (missing) return;
    const lines = form.missing.map((k) => `${LABEL[k].replace(/\?$/, "")}: ${v[k]}`);
    setSent(true);
    onSubmit(`Here are the details: ${lines.join("; ")}.`);
  }
  return (
    <form className="aw-predraft" onSubmit={submit} aria-label="Before I draft the deal">
      <header>
        <div>
          <small>BEFORE I DRAFT THE {form.side === "sell" ? "OFFER" : "DEAL"}</small>
          <h2>I need a few more details</h2>
        </div>
        <span role="status">{sent ? "Sent" : `${missing} of ${form.missing.length} missing`}</span>
      </header>
      {Object.entries(form.known).some(([, x]) => x) && (
        <div className="aw-predraft-known">
          {Object.entries(form.known)
            .filter(([, x]) => x)
            .map(([k, x]) => (
              <div key={k}>
                <i>✓</i>
                <span>{KNOWN[k] ?? k}</span>
                <b>{x}</b>
              </div>
            ))}
        </div>
      )}
      {form.missing.map((k) => (
        <fieldset key={k} className={(v[k] ?? "").trim() ? "complete" : ""} disabled={sent || disabled}>
          <legend className="sr-only">{LABEL[k]}</legend>
          <label htmlFor={`df-${k}`}>
            <i>{(v[k] ?? "").trim() ? "✓" : "?"}</i>
            <b>{LABEL[k]}</b>
            <small>{(v[k] ?? "").trim() ? "complete" : "missing"}</small>
          </label>
          {k === "counterparty" &&
            (form.contacts.length ? (
              choice(
                k,
                form.contacts.map((c) => [c, c]),
              )
            ) : (
              <input id={`df-${k}`} placeholder="Their name" value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
            ))}
          {k === "kind" &&
            choice(k, [
              ["hire (a service or work)", "Hire · service"],
              ["buy a digital file", "▤ Digital file"],
              ["buy a physical item, shipped as a parcel", "▣ Physical item"],
            ])}
          {k === "work" && <input id={`df-${k}`} maxLength={300} placeholder="e.g. a logo, 3 concepts" value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />}
          {k === "price" && (
            <input id={`df-${k}`} inputMode="decimal" placeholder={`e.g. ${sign}5,000`} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value.replace(/[^\d.,]/g, "") ? `${sign}${e.target.value.replace(/[^\d.,]/g, "")}` : "")} />
          )}
          {k === "milestones" &&
            choice(k, [
              ["one payment on delivery", "1 payment"],
              ["2 milestones, split evenly", "2 milestones"],
              ["3 milestones, split evenly", "3 milestones"],
            ])}
          {k === "deadline" &&
            choice(k, [
              ["7 days", "7 days"],
              ["14 days", "14 days"],
              ["30 days", "30 days"],
            ])}
          {k === "acceptance" && <input id={`df-${k}`} maxLength={600} placeholder="e.g. 3 concepts + final AI/PNG/SVG files" value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />}
          {k === "ship_to" && (
            <>
              <input id={`df-${k}`} maxLength={300} placeholder="Name, phone, number, road, sub-district, district, province, postcode" value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
              <div className="aw-predraft-options">
                <button type="button" onClick={() => void fillSavedAddress()}>
                  Use my saved address
                </button>
              </div>
              {addressNote && <small className="aw-predraft-hint">{addressNote}</small>}
            </>
          )}
          {k === "file_types" && (
            <>
              <div className="aw-predraft-options">
                {FORMATS.map((f) => (
                  <button type="button" key={f} aria-pressed={formats.includes(f)} onClick={() => toggleFormat(f)}>
                    {f}
                  </button>
                ))}
              </div>
              <input id={`df-${k}`} maxLength={120} placeholder="Or type them, e.g. PDF, DWG" value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
            </>
          )}
          {k === "deposit" &&
            choice(k, [
              ["no deposit", "No deposit"],
              ["20% deposit paid on signing", "20% on signing"],
              ["30% deposit paid on signing", "30% on signing"],
              ["50% deposit paid on signing", "50% on signing"],
            ])}
        </fieldset>
      ))}
      <p className="aw-predraft-info">
        <span>ⓘ</span>Nothing is drafted, locked or paid yet. The AI drafts the deal from these answers; you approve it after.
      </p>
      <footer>
        <Button type="submit" disabled={missing > 0 || sent || disabled}>
          {sent ? "Sent to the AI" : "Draft deal"}
        </Button>
        <span>{sent ? "The AI is drafting it…" : "Answer above to create your draft"}</span>
      </footer>
    </form>
  );
}
