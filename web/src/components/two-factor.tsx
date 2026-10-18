"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";

import { api } from "./app-data";
import { toast } from "./header-tools";
import { Button, Card, Loading } from "./mockup-ui";

type Method = "pin" | "email" | "sms" | "face" | "fingerprint" | "passkey";
type Status = { enabled: boolean; verified: boolean; methods: Method[]; hasPin: boolean; devices: number; phone: string | null; email?: string };

const LABEL: Record<Method, [string, string]> = {
  face: ["🙂", "Face scan"],
  fingerprint: ["👆", "Fingerprint"],
  passkey: ["🔑", "Passkey"],
  pin: ["🔢", "6-digit PIN"],
  sms: ["💬", "SMS code"],
  email: ["✉️", "Email code"],
};
const ORDER: Method[] = ["face", "fingerprint", "passkey", "pin", "sms", "email"];

const post = <T,>(body: unknown) => api<T & { status: Status }>("/api/security", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const webauthn = () => typeof window !== "undefined" && "PublicKeyCredential" in window && !!navigator.credentials;

/** Makes a credential on this device (Touch ID / Face ID / Windows Hello / security key). */
async function registerDevice(email: string, platform: boolean): Promise<string> {
  if (!webauthn()) throw new Error("This browser has no Face ID / fingerprint / passkey support");
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Agentic Wallet", id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: email || "user", displayName: email || "Agentic Wallet user" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { ...(platform ? { authenticatorAttachment: "platform" as const } : {}), userVerification: "required", residentKey: "preferred" },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No credential was made");
  return b64url(cred.rawId);
}

/** Asks this device to confirm it's the user (biometric or device PIN); returns the credential id. */
async function confirmOnDevice(): Promise<string> {
  if (!webauthn()) throw new Error("This browser has no Face ID / fingerprint / passkey support");
  const a = (await navigator.credentials.get({
    publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, userVerification: "required", timeout: 60_000 },
  })) as PublicKeyCredential | null;
  if (!a) throw new Error("Cancelled");
  return b64url(a.rawId);
}

/** The second step after signing in, shown until one of the user's methods passes. */
function Challenge({ status, onPassed }: { status: Status; onPassed: () => void }) {
  const available = ORDER.filter((m) => status.methods.includes(m));
  const [method, setMethod] = useState<Method>(available[0]);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ sentTo: string; demoCode: string | null } | null>(null);
  const device = method === "face" || method === "fingerprint" || method === "passkey";

  async function go(value = secret) {
    setBusy(true);
    setError(null);
    try {
      await post({ action: "verify", method, secret: value });
      toast({ text: "Verified. Welcome back.", tone: "ok" });
      onPassed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendCode(m: "email" | "sms") {
    setBusy(true);
    setError(null);
    try {
      setSent(await post<{ sentTo: string; demoCode: string | null }>({ action: "code", method: m }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function scan() {
    setBusy(true);
    setError(null);
    try {
      await go(await confirmOnDevice());
    } catch (e) {
      setError((e as Error).message.includes("not allowed") ? "Cancelled or timed out. Try again." : (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="aw-2fa-wrap">
      <Card className="aw-2fa-card">
        <span className="aw-2fa-lock" aria-hidden>
          🔐
        </span>
        <h1>Verify it&apos;s you</h1>
        <p>Your account has two-step sign-in on. Choose one way to confirm.</p>
        <div className="aw-2fa-methods" role="tablist">
          {available.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={method === m}
              className={method === m ? "active" : ""}
              onClick={() => {
                setMethod(m);
                setSecret("");
                setError(null);
                setSent(null);
              }}
            >
              <span>{LABEL[m][0]}</span>
              {LABEL[m][1]}
            </button>
          ))}
        </div>
        {device && (
          <div className="aw-2fa-device">
            <div className={`aw-2fa-scan ${method}${busy ? " busy" : ""}`} aria-hidden>
              {LABEL[method][0]}
            </div>
            <Button onClick={() => void scan()} disabled={busy}>
              {busy ? "Waiting for your device…" : method === "face" ? "Scan my face" : method === "fingerprint" ? "Use my fingerprint" : "Use my passkey"}
            </Button>
            <small>Your device asks for Face ID, Touch ID, Windows Hello or your security key.</small>
          </div>
        )}
        {(method === "email" || method === "sms") && !sent && (
          <Button onClick={() => void sendCode(method)} disabled={busy}>
            {busy ? "Sending…" : method === "email" ? `Email me a code (${status.email ?? "your email"})` : `Text me a code (${status.phone ?? "your phone"})`}
          </Button>
        )}
        {(method === "pin" || ((method === "email" || method === "sms") && sent)) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void go();
            }}
          >
            {sent && (
              <p className="aw-2fa-sent">
                Code sent to {sent.sentTo}.
                {sent.demoCode && (
                  <>
                    {" "}
                    <b>Demo code: {sent.demoCode}</b>
                  </>
                )}
              </p>
            )}
            <input
              className="aw-2fa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={secret}
              onChange={(e) => setSecret(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              aria-label={method === "pin" ? "Your 6-digit PIN" : "The 6-digit code"}
            />
            <Button type="submit" disabled={busy || secret.length !== 6}>
              {busy ? "Checking…" : "Verify"}
            </Button>
            {sent && (
              <button type="button" className="aw-2fa-link" onClick={() => void sendCode(method as "email" | "sms")} disabled={busy}>
                Send a new code
              </button>
            )}
          </form>
        )}
        {error && <p className="aw-bank-error">{error}</p>}
      </Card>
    </div>
  );
}

/** Wraps the signed-in app: when 2FA is on and this session has not passed it, only the challenge shows. */
export function TwoFactorGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null | "off">(null);
  const load = useCallback(() => {
    api<Status>("/api/security")
      .then((s) => setStatus(s.enabled && !s.verified ? s : "off"))
      .catch(() => setStatus("off"));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (status === null) return <Loading block text="Checking your sign-in…" />;
  if (status !== "off") return <Challenge status={status} onPassed={() => window.location.reload()} />;
  return <>{children}</>;
}

/** Profile → Two-step sign-in: set up methods and turn them on or off. */
export function SecurityCard() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pin, setPin] = useState("");
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState<"pin" | "phone" | null>(null);
  useEffect(() => {
    api<Status>("/api/security").then(setS).catch(() => setS(null));
  }, []);

  async function run(key: string, body: unknown, ok: string) {
    setBusy(key);
    setMsg(null);
    try {
      const r = await post(body);
      setS({ ...r.status, email: s?.email });
      setMsg({ ok: true, text: ok });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }
  if (!s) return null;
  const ready = (m: Method) => (m === "pin" ? s.hasPin : m === "sms" ? Boolean(s.phone) : m === "email" ? true : s.devices > 0);
  const toggle = (m: Method) => run(`t${m}`, { action: "methods", methods: s.methods.includes(m) ? s.methods.filter((x) => x !== m) : [...s.methods, m] }, s.methods.includes(m) ? `${LABEL[m][1]} turned off` : `${LABEL[m][1]} turned on`);

  return (
    <Card className="aw-2fa-settings">
      <header>
        <div>
          <h2>Two-step sign-in (2FA)</h2>
          <small>{s.enabled ? `On · ${s.methods.map((m) => LABEL[m][1]).join(", ")}` : "Off: turn on at least one method"}</small>
        </div>
        <span className={`aw-2fa-badge ${s.enabled ? "on" : ""}`}>{s.enabled ? "ON" : "OFF"}</span>
      </header>
      <p className="aw-2fa-note">After you sign in, the app asks for one of these before money, deals or contacts open. Demo: SMS is simulated; email codes are shown on screen when no mailer is set up; device checks use your browser&apos;s Face ID / Touch ID / passkey.</p>
      {ORDER.map((m) => (
        <div className="aw-2fa-row" key={m}>
          <span className="aw-2fa-row-name">
            <i aria-hidden>{LABEL[m][0]}</i>
            {LABEL[m][1]}
            {m === "sms" && s.phone && <small> · {s.phone}</small>}
          </span>
          <span className="aw-2fa-row-actions">
            {m === "pin" && (
              <button type="button" onClick={() => setEditing(editing === "pin" ? null : "pin")}>
                {s.hasPin ? "Change PIN" : "Set PIN"}
              </button>
            )}
            {m === "sms" && (
              <button type="button" onClick={() => setEditing(editing === "phone" ? null : "phone")}>
                {s.phone ? "Change number" : "Add number"}
              </button>
            )}
            {(m === "face" || m === "fingerprint" || m === "passkey") && (
              <button
                type="button"
                disabled={!!busy}
                onClick={async () => {
                  setBusy(`d${m}`);
                  try {
                    const id = await registerDevice(s.email ?? "", m !== "passkey");
                    await run(`d${m}`, { action: "device", credentialId: id }, "This device is registered");
                  } catch (e) {
                    setMsg({ ok: false, text: (e as Error).message });
                    setBusy(null);
                  }
                }}
              >
                {busy === `d${m}` ? "Waiting for device…" : s.devices > 0 ? "Add this device" : "Register this device"}
              </button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={s.methods.includes(m)}
              aria-label={`${LABEL[m][1]} ${s.methods.includes(m) ? "on" : "off"}`}
              className={`aw-profile-toggle${s.methods.includes(m) ? " on" : ""}`}
              disabled={!!busy || (!ready(m) && !s.methods.includes(m))}
              title={ready(m) ? "" : "Set it up first"}
              onClick={() => void toggle(m)}
            >
              <i />
            </button>
          </span>
          {editing === "pin" && m === "pin" && (
            <form
              className="aw-2fa-inline"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run("pin", { action: "pin", pin }, "PIN saved")) {
                  setPin("");
                  setEditing(null);
                }
              }}
            >
              <input inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="New 6-digit PIN" aria-label="New 6-digit PIN" />
              <Button type="submit" disabled={pin.length !== 6 || busy === "pin"}>
                {busy === "pin" ? "Saving…" : "Save PIN"}
              </Button>
            </form>
          )}
          {editing === "phone" && m === "sms" && (
            <form
              className="aw-2fa-inline"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run("phone", { action: "phone", phone }, "Phone number saved")) setEditing(null);
              }}
            >
              <input inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08x-xxx-xxxx" aria-label="Phone number" />
              <Button type="submit" disabled={busy === "phone"}>
                {busy === "phone" ? "Saving…" : "Save number"}
              </Button>
            </form>
          )}
        </div>
      ))}
      {msg && <p className={msg.ok ? "aw-live-ok" : "aw-bank-error"}>{msg.text}</p>}
    </Card>
  );
}
