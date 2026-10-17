"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";

import { localizeMockupNode, useLang } from "@/lib/i18n";

import { api } from "./app-data";
import { Button, Card } from "./mockup-ui";

type Tree = [string, [string, [string, string][]][]][];
type Address = { recipient: string; phone: string; line: string; subdistrict: string; district: string; province: string; postcode: string };
const EMPTY: Address = { recipient: "", phone: "", line: "", subdistrict: "", district: "", province: "", postcode: "" };

let cache: Promise<Tree> | null = null;
const loadTree = () => (cache ??= fetch("/api/address/th").then((r) => (r.ok ? (r.json() as Promise<Tree>) : Promise.reject(new Error("Could not load the address list")))));

/**
 * The saved delivery address, Thai style: pick the province, then the district (อำเภอ / เขต), then
 * the sub-district (ตำบล / แขวง); the postcode follows. Offered for parcel deals; the AI can read and
 * change it too ("change my address to …").
 */
export function AddressCard() {
  const lang = useLang();
  const [tree, setTree] = useState<Tree | null>(null);
  const [saved, setSaved] = useState<{ address: Address | null; text: string | null } | null>(null);
  const [form, setForm] = useState<Address>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<{ address: Address | null; text: string | null }>("/api/profile/address")
      .then(setSaved)
      .catch(() => setSaved({ address: null, text: null }));
  }, []);
  useEffect(() => {
    if (!editing || tree) return;
    loadTree()
      .then(setTree)
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, [editing, tree]);

  const districts = useMemo(() => tree?.find(([p]) => p === form.province)?.[1] ?? [], [tree, form.province]);
  const subdistricts = useMemo(() => districts.find(([d]) => d === form.district)?.[1] ?? [], [districts, form.district]);
  const postcodes = useMemo(() => [...new Set(subdistricts.filter(([s]) => s === form.subdistrict).map(([, c]) => c))], [subdistricts, form.subdistrict]);
  const bkk = form.province === "กรุงเทพมหานคร";
  const set = (patch: Partial<Address>) => setForm((f) => ({ ...f, ...patch }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ address: Address; text: string }>("/api/profile/address", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      setSaved(r);
      setEditing(false);
      setMsg({ ok: true, text: "Address saved." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return localizeMockupNode(
    <Card className="aw-address-card">
      <header>
        <div>
          <h2>Delivery address</h2>
          <small>For parcels you buy. The AI offers it when a deal ships something, and can change it when you ask.</small>
        </div>
        {!editing && (
          <Button
            variant="outline"
            onClick={() => {
              setForm(saved?.address ?? EMPTY);
              setMsg(null);
              setEditing(true);
            }}
          >
            {saved?.address ? "Edit" : "Add address"}
          </Button>
        )}
      </header>
      {!editing && <p className="aw-address-text">{saved === null ? "…" : (saved.text ?? "No address saved yet.")}</p>}
      {editing && (
        <form className="aw-address-form" onSubmit={save}>
          <label>
            <span>Recipient</span>
            <input value={form.recipient} onChange={(e) => set({ recipient: e.target.value })} autoComplete="name" required minLength={2} maxLength={120} />
          </label>
          <label>
            <span>Phone</span>
            <input value={form.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" autoComplete="tel" placeholder="0812345678" required maxLength={20} />
          </label>
          <label className="wide">
            <span>House no., village / building, soi, road</span>
            <input value={form.line} onChange={(e) => set({ line: e.target.value })} autoComplete="street-address" required minLength={3} maxLength={200} />
          </label>
          <label>
            <span>Province · จังหวัด</span>
            <select value={form.province} onChange={(e) => set({ province: e.target.value, district: "", subdistrict: "", postcode: "" })} required disabled={!tree}>
              <option value="">{tree ? "Choose…" : "Loading…"}</option>
              {tree?.map(([p]) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{bkk ? "District · เขต" : "District · อำเภอ"}</span>
            <select value={form.district} onChange={(e) => set({ district: e.target.value, subdistrict: "", postcode: "" })} required disabled={!districts.length}>
              <option value="">Choose…</option>
              {districts.map(([d]) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{bkk ? "Sub-district · แขวง" : "Sub-district · ตำบล"}</span>
            <select
              value={form.subdistrict}
              onChange={(e) => {
                const codes = subdistricts.filter(([s]) => s === e.target.value).map(([, c]) => c);
                set({ subdistrict: e.target.value, postcode: codes[0] ?? "" });
              }}
              required
              disabled={!subdistricts.length}
            >
              <option value="">Choose…</option>
              {[...new Set(subdistricts.map(([s]) => s))].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Postcode · รหัสไปรษณีย์</span>
            {postcodes.length > 1 ? (
              <select value={form.postcode} onChange={(e) => set({ postcode: e.target.value })}>
                {postcodes.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            ) : (
              <input value={form.postcode} readOnly placeholder="Filled from the sub-district" />
            )}
          </label>
          <div className="aw-address-actions">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save address"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {msg && <p className={msg.ok ? "aw-live-ok" : "aw-bank-error"}>{msg.text}</p>}
    </Card>,
    lang,
  );
}
