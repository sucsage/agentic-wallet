"use client";

import { useEffect, useState } from "react";

import { setLang, useLang } from "@/lib/i18n";

import { AiUsageBars } from "./ai-usage";
import { api } from "./app-data";
import { Card } from "./mockup-ui";

/** Profile & Privacy choices (Napat's preferences card), saved on the server. */
export type Prefs = { showAlso: "THB" | "CNY" | null; aiChat: boolean; cardCover: boolean };

let cache: Prefs | null = null;
const listeners = new Set<(p: Prefs) => void>();

/** The user's preferences, shared by every component that shows them. */
export function usePrefs(): [Prefs | null, (patch: Partial<Prefs>) => Promise<void>] {
  const [p, setP] = useState<Prefs | null>(cache);
  useEffect(() => {
    listeners.add(setP);
    if (!cache) {
      api<Prefs>("/api/me/preferences")
        .then((r) => {
          cache = r;
          listeners.forEach((l) => l(r));
        })
        .catch(() => {});
    }
    return () => {
      listeners.delete(setP);
    };
  }, []);
  const save = async (patch: Partial<Prefs>) => {
    const r = await api<Prefs>("/api/me/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    cache = r;
    listeners.forEach((l) => l(r));
  };
  return [p, save];
}

/** Demo display rate (Napat's): ¥1 = ฿4.90. Display only; deals never convert. */
export const RATE_THB_PER_CNY = 4.9;
export function alsoIn(amount: number, from: "THB" | "CNY", to: "THB" | "CNY" | null): string | null {
  if (!to || to === from) return null;
  const v = from === "THB" ? amount / RATE_THB_PER_CNY : amount * RATE_THB_PER_CNY;
  return `≈ ${to === "THB" ? "฿" : "¥"}${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className="aw-pref-row">
      <span>
        <b>{label}</b>
        <small>{hint}</small>
      </span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function PreferencesCard({ currency }: { currency: "THB" | "CNY" }) {
  const [p, save] = usePrefs();
  const lang = useLang();
  const [err, setErr] = useState<string | null>(null);
  const change = (patch: Partial<Prefs>) => save(patch).catch((e: Error) => setErr(e.message));
  const other = currency === "THB" ? "CNY" : "THB";
  return (
    <Card className="aw-pref-card">
      <h2>Preferences</h2>
      <div className="aw-pref-row">
        <span>
          <b>Show amounts also in</b>
          <small>Display only, at the demo rate ¥1 = ฿4.90. Deals are always paid in {currency}.</small>
        </span>
        <select value={p?.showAlso ?? ""} disabled={!p} onChange={(e) => void change({ showAlso: (e.target.value || null) as Prefs["showAlso"] })}>
          <option value="">Off</option>
          <option value={other}>{other}</option>
        </select>
      </div>
      <div className="aw-pref-row">
        <span>
          <b>Language</b>
          <small>The app and the AI&apos;s replies.</small>
        </span>
        <span className="aw-pref-lang">
          <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>
            English
          </button>
          <button type="button" aria-pressed={lang === "th"} onClick={() => setLang("th")}>
            ไทย
          </button>
        </span>
      </div>
      <Toggle
        on={p?.aiChat ?? true}
        disabled={!p}
        onChange={(v) => void change({ aiChat: v })}
        label="Send messages to the AI"
        hint="Off: the AI chat is disabled and nothing is sent to a model. Names only either way: never addresses or ID numbers."
      />
      <AiUsageBars />
      {err && <p className="aw-bank-error">{err}</p>}
    </Card>
  );
}
