"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

import { api, useAppData } from "./app-data";
import { Button, Card, Loading } from "./mockup-ui";

/**
 * Sign up / log in with email and password, like a mobile wallet app. No bank login: the wallet
 * itself holds THB or CNY e-money (test money), topped up by card, PromptPay or counter service.
 */
export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r =
      mode === "register"
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (r.error) setError(r.error.message ?? "Something went wrong");
    else onSignedIn();
  }

  return (
    <main className="aw-auth-wrap aw-bank-login-wrap">
      <Card className="aw-bank-login aw-wallet-auth">
        <div className="aw-wallet-auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            Create account
          </button>
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Log in
          </button>
        </div>
        <form onSubmit={submit} className="aw-wallet-auth-form">
          {mode === "register" && (
            <label>
              <span>Full name (as on your ID)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" />
            </label>
          )}
          <label>
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label>
            <span>Password {mode === "register" && <small>(8+ characters)</small>}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </label>
          {mode === "register" && (
            <label className="aw-bank-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I agree to the Terms and the Privacy Policy (PDPA), and to identity verification before my wallet opens.</span>
            </label>
          )}
          {error && <p className="aw-bank-error">{error}</p>}
          <Button type="submit" disabled={busy || (mode === "register" && !consent)}>
            {busy ? "…" : mode === "register" ? "Create account" : "Log in"}
          </Button>
        </form>
        <p className="aw-bank-footnote">
          After signing up you verify your identity (KYC), then your wallet opens with a THB or CNY balance you top up. Test money only, no real funds.
        </p>
        <Link className="aw-wallet-legacy" href="/th/authorize">
          Team test accounts (older Mock Bank sign-in)
        </Link>
      </Card>
    </main>
  );
}

type KycInfo = {
  autoApprove: boolean;
  application: { status: "PENDING" | "APPROVED" | "REJECTED"; method: string; maskedId: string; legalName: string; note: string | null } | null;
};

/** Identity verification before the wallet opens: a national digital ID, or ID details typed in. */
export function OnboardingScreen() {
  const { me, refresh } = useAppData();
  const [info, setInfo] = useState<KycInfo | null>(null);
  const [country, setCountry] = useState<"TH" | "CN">("TH");
  const [manual, setManual] = useState(false);
  const [legalName, setLegalName] = useState(me?.user.name ?? "");
  const [idType, setIdType] = useState<"NATIONAL_ID" | "PASSPORT">("NATIONAL_ID");
  const [idNumber, setIdNumber] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    // The digital ID sends the user back with ?kyc=ok, pending or an error message.
    const r = new URLSearchParams(window.location.search).get("kyc");
    if (r) {
      window.history.replaceState(null, "", window.location.pathname);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (r !== "ok" && r !== "pending") setMsg(r);
    }
    api<KycInfo>("/api/kyc").then(setInfo).catch(() => setInfo(null));
  }, []);

  async function digitalId() {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/api/kyc/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ country }),
      });
      window.location.assign(url);
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  }

  async function submitManual(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/kyc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ country, legalName, idType, idNumber, birthDate }),
      });
      await refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status = me?.onboarding?.status;
  if (status === "PENDING") {
    return (
      <main className="aw-onboarding">
        <Card>
          <h1>Your identity is being reviewed</h1>
          <p>A reviewer checks your details before your wallet opens. This page updates when it is decided.</p>
          <Button variant="outline" onClick={() => void refresh()}>
            Check again
          </Button>
        </Card>
      </main>
    );
  }
  return (
    <main className="aw-onboarding">
      <Card>
        <small className="aw-onboarding-step">STEP 2 OF 2 · VERIFY YOUR IDENTITY (KYC)</small>
        <h1>Open your wallet</h1>
        <p>
          Hi {me?.user.name}. Before your wallet opens we verify who you are, as e-money rules require. Your country decides your wallet&apos;s currency.
        </p>
        {status === "REJECTED" && <p className="aw-bank-error">Your last application was not approved{me?.onboarding?.note ? `: ${me.onboarding.note}` : ""}. You can apply again.</p>}
        {msg && <p className="aw-bank-error">{msg}</p>}
        {!info && <Loading text="Loading…" />}
        <div className="aw-onboarding-country" role="radiogroup" aria-label="Country">
          {(
            [
              ["TH", "🇹🇭 Thailand", "Thai baht (THB) wallet"],
              ["CN", "🇨🇳 China", "Chinese yuan (CNY) wallet"],
            ] as const
          ).map(([c, title, sub]) => (
            <button type="button" role="radio" aria-checked={country === c} key={c} className={country === c ? "active" : ""} onClick={() => setCountry(c)}>
              <b>{title}</b>
              <small>{sub}</small>
            </button>
          ))}
        </div>
        {!manual ? (
          <>
            <Button disabled={busy} onClick={() => void digitalId()}>
              {busy ? "Opening…" : country === "TH" ? "Verify with ThaID" : "Verify with 国家网络身份认证"}
            </Button>
            <button type="button" className="aw-onboarding-alt" onClick={() => setManual(true)}>
              No digital ID? Enter your ID details instead
            </button>
          </>
        ) : (
          <form className="aw-wallet-auth-form" onSubmit={submitManual}>
            <label>
              <span>Full name as on your ID</span>
              <input value={legalName} onChange={(e) => setLegalName(e.target.value)} required minLength={2} />
            </label>
            <label>
              <span>Document</span>
              <select value={idType} onChange={(e) => setIdType(e.target.value as "NATIONAL_ID" | "PASSPORT")}>
                <option value="NATIONAL_ID">{country === "TH" ? "Thai national ID card" : "Chinese resident ID card"}</option>
                <option value="PASSPORT">Passport</option>
              </select>
            </label>
            <label>
              <span>{idType === "PASSPORT" ? "Passport number" : country === "TH" ? "13-digit ID number" : "18-character ID number"}</span>
              <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} required />
            </label>
            <label>
              <span>Date of birth</span>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
            </label>
            <div className="aw-topup-actions">
              <Button type="button" variant="outline" onClick={() => setManual(false)}>
                Back
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Submitting…" : "Submit for verification"}
              </Button>
            </div>
          </form>
        )}
        <small className="aw-kyc-note">
          {info?.autoApprove
            ? "Demo: applications are approved at once. In production a reviewer checks each one (with sanctions screening and a liveness check)."
            : "A reviewer checks each application."}{" "}
          We keep a masked ID number and a hash, never the number itself.
        </small>
      </Card>
    </main>
  );
}
