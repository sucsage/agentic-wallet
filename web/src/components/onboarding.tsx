"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

import { api, useAppData } from "./app-data";
import { Button, Card, Loading } from "./mockup-ui";

/** A ?next= target only if it stays on this site: a path, never "//other.site" or a full URL. */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login")) return null;
  return next.slice(0, 500);
}

type AuthOptions = { google: boolean; apple: boolean; passwordReset: boolean };

/**
 * Sign up / log in with email and password, or Google / Apple, like a mobile wallet app. No bank
 * login: the wallet itself holds THB or CNY e-money (test money), topped up by card, PromptPay or
 * counter service. A forgotten password is reset through a link sent by email.
 */
export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [options, setOptions] = useState<AuthOptions | null>(null);

  useEffect(() => {
    // Links from an invite page say which form to open: ?mode=login (sign up is the default).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).get("mode") === "login") setMode("login");
  }, []);

  useEffect(() => {
    api<AuthOptions>("/api/auth-options").then(setOptions).catch(() => setOptions(null));
  }, []);
  // Sent here from a page that needs sign-in (src/proxy.ts) or from a seller invite: go back there.
  const nextPath = () => safeNext(new URLSearchParams(window.location.search).get("next"));
  const signedIn = () => {
    const next = nextPath();
    if (next) window.location.assign(next);
    else onSignedIn();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === "forgot") {
      const r = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
      setBusy(false);
      if (r.error) setError(r.error.message ?? "Something went wrong");
      else setSent(true);
      return;
    }
    const r =
      mode === "register"
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (r.error) setError(r.error.message ?? "Something went wrong");
    else signedIn();
  }

  async function social(provider: "google" | "apple") {
    setBusy(true);
    setError(null);
    // On success the browser is already on its way to the provider.
    const r = await authClient.signIn.social({ provider, callbackURL: nextPath() ?? "/chat" });
    if (r.error) {
      setError(r.error.message ?? "Something went wrong");
      setBusy(false);
    }
  }

  const switchTo = (m: typeof mode) => {
    setMode(m);
    setError(null);
    setSent(false);
  };

  if (mode === "forgot") {
    return (
      <main className="aw-auth-wrap aw-bank-login-wrap">
        <Card className="aw-bank-login aw-wallet-auth">
          <h2>Reset your password</h2>
          {sent ? (
            <p className="aw-auth-note">
              If an account uses <b>{email.trim()}</b>, a reset link is on its way. It works for 30 minutes. Check your spam folder too.
            </p>
          ) : (
            <form onSubmit={submit} className="aw-wallet-auth-form">
              <p className="aw-auth-note">Enter the email you signed up with. We send a link to choose a new password.</p>
              <label>
                <span>Email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
              </label>
              {error && <p className="aw-bank-error">{error}</p>}
              <Button type="submit" disabled={busy}>
                {busy ? "…" : "Send reset link"}
              </Button>
            </form>
          )}
          <button type="button" className="aw-onboarding-alt" onClick={() => switchTo("login")}>
            Back to log in
          </button>
        </Card>
      </main>
    );
  }

  return (
    <main className="aw-auth-wrap aw-bank-login-wrap">
      <Card className="aw-bank-login aw-wallet-auth">
        <div className="aw-wallet-auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchTo("register")}>
            Create account
          </button>
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => switchTo("login")}>
            Log in
          </button>
        </div>
        {(options?.google || options?.apple) && (
          <div className="aw-auth-social">
            {options.google && (
              <button type="button" onClick={() => void social("google")} disabled={busy}>
                <GoogleIcon /> Continue with Google
              </button>
            )}
            {options.apple && (
              <button type="button" className="apple" onClick={() => void social("apple")} disabled={busy}>
                <AppleIcon /> Continue with Apple
              </button>
            )}
            <span className="aw-auth-or">or with email</span>
          </div>
        )}
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
          {mode === "login" && options?.passwordReset && (
            <button type="button" className="aw-auth-forgot" onClick={() => switchTo("forgot")}>
              Forgot password?
            </button>
          )}
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

/** Where the emailed reset link lands (?token=…, or ?error=INVALID_TOKEN when it expired). */
export function ResetPasswordScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(q.get("token") ?? "");
    if (q.get("error")) setError("This link has expired or was already used. Ask for a new one.");
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== again) return setError("The two passwords are different");
    setBusy(true);
    setError(null);
    const r = await authClient.resetPassword({ newPassword: password, token: token ?? "" });
    setBusy(false);
    if (r.error) setError(r.error.message ?? "Something went wrong");
    else setDone(true);
  }

  return (
    <main className="aw-auth-wrap aw-bank-login-wrap">
      <Card className="aw-bank-login aw-wallet-auth">
        <h2>Choose a new password</h2>
        {token === null ? (
          <Loading />
        ) : done ? (
          <>
            <p className="aw-auth-note">Your password is changed, and every other device was signed out.</p>
            <Link className="aw-button aw-button-primary" href="/login">
              Log in
            </Link>
          </>
        ) : !token ? (
          <>
            <p className="aw-bank-error">{error ?? "This page needs the link from the reset email."}</p>
            <Link className="aw-onboarding-alt" href="/login">
              Back to log in
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="aw-wallet-auth-form">
            <label>
              <span>
                New password <small>(8+ characters)</small>
              </span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" autoFocus />
            </label>
            <label>
              <span>Type it again</span>
              <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" />
            </label>
            {error && <p className="aw-bank-error">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? "…" : "Save new password"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1c.9-2.8 3.5-4.9 6.6-4.9z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4a10 10 0 0 0 1.4-2.8c0-.1-2.6-1-2.6-4.2zM13.9 5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z" />
    </svg>
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
