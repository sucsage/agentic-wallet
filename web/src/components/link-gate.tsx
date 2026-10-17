"use client";

import { type FormEvent, useState } from "react";

/**
 * The door of a private link (lib/link-access): the one-time code the inviter sent plus a new
 * password on the first visit, the password after that, and "Forgot password", which shows a reset
 * code to send to the inviter. Styled with the link pages' own CSS (invite.css).
 */
export function LinkGate({ kind, token, state, inviter, onOpen }: { kind: "invite" | "pay"; token: string; state: "otp" | "password"; inviter: string; onOpen: () => void }) {
  const [mode, setMode] = useState<"otp" | "password" | "forgot">(state);
  const [otp, setOtp] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reset, setReset] = useState<{ code: string; until: string } | null>(null);

  async function post(body: object) {
    const res = await fetch(`/api/link-access/${kind}/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
    return data;
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (mode === "otp" && pw !== pw2) return setErr("The two passwords are not the same");
    setBusy(true);
    try {
      await post(mode === "otp" ? { action: "setup", otp, password: pw } : { action: "login", password: pw });
      onOpen();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function forgot() {
    setErr(null);
    setBusy(true);
    try {
      setReset(await post({ action: "forgot" }));
      setMode("forgot");
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="inv-card inv-gate">
      <b>🔐 This link is protected</b>
      {mode === "forgot" && reset ? (
        <>
          <p>
            Send this reset code to <b>{inviter}</b> (the person who sent you the link). They enter it on their side and send you a new one-time code.
          </p>
          <p className="inv-gate-code">{reset.code}</p>
          <small className="inv-muted">Valid until {new Date(reset.until).toLocaleString()}. Then come back here with the new code.</small>
          <button type="button" className="inv-btn" onClick={() => setMode("otp")}>
            I have the new code
          </button>
        </>
      ) : (
        <form className="inv-form" onSubmit={submit}>
          {mode === "otp" ? (
            <>
              <p className="inv-muted">
                Enter the 6-digit one-time code {inviter} sent you with this link, and choose your own password. Next time the link asks only for the password.
              </p>
              <label>
                <span>One-time code</span>
                <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} autoFocus />
              </label>
              <label>
                <span>New password (8+ characters, letters and a number)</span>
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required minLength={8} maxLength={100} />
              </label>
              <label>
                <span>Password again</span>
                <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required minLength={8} maxLength={100} />
              </label>
              <button className="inv-btn" type="submit" disabled={busy || otp.length !== 6 || pw.length < 8}>
                {busy ? "Checking…" : "Open the link"}
              </button>
            </>
          ) : (
            <>
              <label>
                <span>Password</span>
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required autoFocus maxLength={100} />
              </label>
              <button className="inv-btn" type="submit" disabled={busy || !pw}>
                {busy ? "Checking…" : "Open the link"}
              </button>
            </>
          )}
          <button type="button" className="inv-linkish" onClick={() => void forgot()} disabled={busy}>
            {mode === "otp" ? "Lost the code?" : "Forgot password?"}
          </button>
        </form>
      )}
      {err && <p className="inv-error">{err}</p>}
    </section>
  );
}
