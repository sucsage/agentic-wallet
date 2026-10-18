"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Consent screen of a MOCK national digital-ID provider. A real flow shows a QR code that the
 * user scans with the ThaID / 国家网络身份认证 app, then approves in the app. With no app in a demo,
 * the user types the ID card details here instead. Clearly a demo: nothing reaches DOPA or the
 * Ministry of Public Security, and the relying party never stores the id number.
 */

type Req = { client_id: string; redirect_uri: string; state: string; nonce: string; code_challenge: string; login_hint: string; scope: string };

const COPY = {
  thaid: {
    name: "Mock ThaID",
    sub: "Thailand · digital ID (DOPA-style) · DEMO",
    scan: "Scan with the ThaID app to approve",
    asks: ["Citizen ID number (pid)", "Name (Thai and English)", "Date of birth"],
    note: "Agentic Wallet keeps only a masked id (1-2345-xxxxx-xx-6) and a hash that stops one person verifying several accounts.",
    accent: "#2f6fed",
  },
  netid: {
    name: "国家网络身份认证 · Mock National Network Identity",
    sub: "China · 网号 / 网证 · 演示 DEMO",
    scan: "使用国家网络身份认证 App 扫码授权 · Scan with the app to approve",
    asks: ["网号 (your network ID number, no ID number inside)", "姓名核验 (yes/no: is the person opening the wallet you?)"],
    note: "Privacy by design: Agentic Wallet never receives your resident ID number or your name, only the 网号 and a name-match result.",
    accent: "#c8102e",
  },
} as const;

/** A random, valid Thai citizen id or Chinese resident id, for the demo button. */
function sampleId(provider: "thaid" | "netid"): string {
  const r = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
  if (provider === "thaid") {
    const body = String(1 + Math.floor(Math.random() * 8)) + r(11);
    const sum = [...body].reduce((t, d, i) => t + Number(d) * (13 - i), 0);
    return body + ((11 - (sum % 11)) % 10);
  }
  const body = `110105${1980 + Math.floor(Math.random() * 25)}0${1 + Math.floor(Math.random() * 9)}1${Math.floor(Math.random() * 9)}${r(3)}`;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = [...body].reduce((t, d, i) => t + Number(d) * w[i], 0);
  return body + "10X98765432"[sum % 11];
}

export function MockIdPage({ provider, request }: { provider: "thaid" | "netid"; request: Req }) {
  const c = COPY[provider];
  const thai = provider === "thaid";
  const [qr, setQr] = useState<string | null>(null);
  const [id, setId] = useState("");
  const [given, setGiven] = useState("");
  const [family, setFamily] = useState("");
  const [full, setFull] = useState("");
  const [birth, setBirth] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void QRCode.toDataURL(`mock-id://${provider}/approve?state=${request.state}`, { margin: 1, width: 180 }).then(setQr);
  }, [provider, request.state]);

  function fillSample() {
    setId(sampleId(provider));
    const parts = request.login_hint.trim().split(/\s+/);
    if (thai) {
      // One word ("Sage"): it is the given name; the family name stays empty.
      setGiven(parts[0] ?? "Test");
      setFamily(parts.slice(1).join(" "));
      setBirth("1999-05-17");
    } else setFull(request.login_hint);
  }

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/mock-id/${provider}/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...request,
          approve,
          identity: { id, given_name: given, family_name: family, full_name: full, birthdate: birth },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      window.location.assign(body.redirect);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-[#333] bg-[#0d0d0d] px-3 py-2 text-sm text-white outline-none focus:border-[#666]";
  return (
    <main className="min-h-screen bg-[#0b0b0c] px-4 py-6 text-[#e8e8e8]">
      <p className="mx-auto mb-4 max-w-md rounded-lg bg-[#f3c13a] px-3 py-2 text-center text-xs font-semibold text-black">
        DEMO identity provider · not a government service · use test data only
      </p>
      <section className="mx-auto max-w-md rounded-2xl border border-[#2a2a2a] bg-[#141416] p-5">
        <header className="mb-4 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl text-lg font-bold text-white" style={{ background: c.accent }}>
            {thai ? "ID" : "网"}
          </span>
          <div>
            <h1 className="text-base font-semibold">{c.name}</h1>
            <small className="text-xs text-[#999]">{c.sub}</small>
          </div>
        </header>
        <p className="text-sm">
          <b>Agentic Wallet</b> asks to verify your identity{request.login_hint ? <> as <b>{request.login_hint}</b>, who is opening a wallet</> : null}. It will receive:
        </p>
        <ul className="my-3 list-disc pl-5 text-sm text-[#cfcfcf]">
          {c.asks.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <div className="my-4 flex items-center gap-4 rounded-xl border border-dashed border-[#333] p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt="QR code for the ID app" width={110} height={110} className="rounded bg-white" />}
          <small className="text-xs text-[#aaa]">
            {c.scan}. No app in this demo: enter the ID card details below instead.
          </small>
        </div>
        <div className="flex flex-col gap-3">
          <label className="text-xs text-[#aaa]">
            {thai ? "Citizen ID (13 digits)" : "居民身份证号码 Resident ID (18)"}
            <input className={input} value={id} onChange={(e) => setId(e.target.value)} inputMode={thai ? "numeric" : "text"} maxLength={20} />
          </label>
          {thai ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-[#aaa]">
                  Given name (EN)
                  <input className={input} value={given} onChange={(e) => setGiven(e.target.value)} />
                </label>
                <label className="text-xs text-[#aaa]">
                  Family name (EN)
                  <input className={input} value={family} onChange={(e) => setFamily(e.target.value)} />
                </label>
              </div>
              <label className="text-xs text-[#aaa]">
                Name in Thai (optional)
                <input className={input} value={full} onChange={(e) => setFull(e.target.value)} />
              </label>
              <label className="text-xs text-[#aaa]">
                Date of birth
                <input className={input} type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
              </label>
            </>
          ) : (
            <label className="text-xs text-[#aaa]">
              姓名 Name on the ID card
              <input className={input} value={full} onChange={(e) => setFull(e.target.value)} />
            </label>
          )}
          <button type="button" onClick={fillSample} className="self-start text-xs text-[#8fb4ff] underline">
            Fill a valid test identity
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-[#ff8a8a]">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void decide(false)} className="flex-1 rounded-lg border border-[#444] px-3 py-2 text-sm">
            Decline
          </button>
          <button
            type="button"
            disabled={busy || !id}
            onClick={() => void decide(true)}
            className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: c.accent }}
          >
            {busy ? "Approving…" : thai ? "Approve in ThaID" : "授权 Approve"}
          </button>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-[#888]">{c.note}</p>
      </section>
    </main>
  );
}
