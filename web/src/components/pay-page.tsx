"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { isPdfDelivery } from "@/lib/file-types";

import { DealFileLinks } from "./deal-file-links";
import { DueControl, type Due } from "./due-control";
import { FileLink, PdfPagePreview } from "./file-preview";
import { CaptureGuard } from "./capture-guard";
import { GuarantorForm } from "./guarantor-form";
import { LinkGate } from "./link-gate";
import "./invite.css";

const KIND = "pay" as const;

/**
 * The page an invited buyer opens (no account): the seller's offer, paying it by card (Stripe test
 * mode; the money waits in escrow), then approving each delivery, which pays the seller and
 * unlocks the file.
 */

type Milestone = {
  index: number;
  amount: string;
  status: string;
  hasFile: boolean;
  name: string;
  acceptance: string | null;
  canApprove: boolean;
  due?: Due | null;
  delivery: { note: string; fileName: string | null; mime: string | null; parcel: { carrierLabel: string; tracking: string; status: string; delivered: boolean | null } | null } | null;
};
type Deal = {
  id: number;
  status: string;
  total: string;
  title: string;
  summary: string | null;
  shipTo: string | null;
  canPay: boolean;
  offerExpiresAt?: string | null;
  guarantorRequired?: boolean;
  guarantor?: { name: string; contact: string; relation: string; amount: number | null } | null;
  files?: { id: string; name: string; mime: string; size: number }[];
  milestones: Milestone[];
};
type View = { name: string; sellerName: string; currency: "THB" | "CNY"; expiresAt: string; balance: string; deals: Deal[]; closesAt?: string | null };

const SIGN = { THB: "฿", CNY: "¥" } as const;
const STEP: Record<string, string> = {
  Pending: "The seller is working on it",
  Delivered: "Delivered · check it, then approve to pay the seller",
  Approved: "Approved · the file unlocks in a moment",
  KeyReleased: "Approved · file unlocked",
  Released: "Paid to the seller",
  Disputed: "In dispute",
  Refunded: "Refunded to you",
  Split: "Split by the arbiter",
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  const body = (await r.json().catch(() => ({}))) as T & { error?: string; linkAccess?: string };
  if (!r.ok) throw Object.assign(new Error(body.error ?? `Request failed (${r.status})`), { linkAccess: body.linkAccess });
  return body;
}

/** The buyer corrects the name the seller typed for them (shown to the seller). */
function BuyerNameEditor({ token, name, onDone }: { token: string; name: string; onDone: () => Promise<void> | void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!editing) {
    return (
      <button type="button" className="inv-name-edit" onClick={() => (setValue(name), setEditing(true))}>
        Not your name? Change it
      </button>
    );
  }
  return (
    <form
      className="inv-name-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const res = await fetch(`/api/pay/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "name", name: value }) });
          if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Could not save");
          await onDone();
          setEditing(false);
        } catch (e2) {
          setErr((e2 as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Your name (shown to the seller)
        <input value={value} onChange={(e) => setValue(e.target.value)} minLength={2} maxLength={80} autoFocus autoComplete="name" />
      </label>
      <button type="submit" disabled={busy || value.trim().length < 2}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={busy}>
        Cancel
      </button>
      {err && <p className="inv-error">{err}</p>}
    </form>
  );
}

export function PayPage({ token }: { token: string }) {
  const base = `/api/pay/${token}`;
  const [gate, setGate] = useState<{ state: "otp" | "password"; inviter: string } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const confirming = useRef(false);

  const load = useCallback(async () => {
    try {
      setView(await call<View>(base));
      setError(null);
      setGate(null);
    } catch (e) {
      const state = (e as Error & { linkAccess?: string }).linkAccess;
      if (state === "otp" || state === "password") {
        // The link needs its one-time code or password: ask for it, then load again.
        const info = await call<{ inviter: string }>(`/api/link-access/${KIND}/${token}`).catch(() => ({ inviter: "the person who sent the link" }));
        setGate({ state, inviter: info.inviter });
        setError(null);
      } else setError((e as Error).message);
    }
  }, [base, token]);

  useEffect(() => {
    // Fetching on mount and polling is the point: the deal moves on its own (delivery, key release).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  // Back from Stripe Checkout: credit the payment and lock the offer, once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const sessionId = q.get("paid");
    const dealId = Number(q.get("deal"));
    if (!sessionId || !Number.isInteger(dealId) || confirming.current) return;
    confirming.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(`pay${dealId}`);
    call<{ status: string; error?: string }>(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm", dealId, sessionId }) })
      .then((r) => setMsg(r.status === "FUNDED" ? { ok: true, text: "Paid. The money waits in escrow until you approve the delivery." } : { ok: false, text: r.error ?? `Payment status: ${r.status}` }))
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }))
      .finally(() => {
        setBusy(null);
        void load();
      });
  }, [base, load]);

  const money = (n: string | number, minor = false) =>
    `${view ? SIGN[view.currency] : ""}${(minor ? Number(n) / 100 : Number(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function pay(d: Deal) {
    setBusy(`pay${d.id}`);
    setMsg(null);
    try {
      const r = await call<{ url: string | null; covered: boolean }>(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "checkout", dealId: d.id }) });
      if (r.url) {
        window.location.assign(r.url);
        return;
      }
      const p = await call<{ status: string; error?: string }>(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pay", dealId: d.id }) });
      setMsg(p.status === "FUNDED" ? { ok: true, text: "Paid from your balance. The money waits in escrow until you approve." } : { ok: false, text: p.error ?? p.status });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function approve(d: Deal, m: Milestone) {
    if (!window.confirm(`Approve "${m.name}"? ${money(m.amount)} goes to ${view?.sellerName ?? "the seller"}, and this cannot be undone.`)) return;
    setBusy(`ok${d.id}:${m.index}`);
    setMsg(null);
    try {
      const r = await call<{ outcome?: { status: string; error?: string } }>(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", dealId: d.id, index: m.index }),
      });
      setMsg(r.outcome?.status === "success" ? { ok: true, text: "Approved: the seller is paid and the file unlocks." } : { ok: false, text: r.outcome?.error ?? "Not approved" });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="inv-page">
      <CaptureGuard />
      <div className="inv-banner">DEMO · test payments only (Stripe test mode) · use test card 4242 4242 4242 4242</div>
      {view?.closesAt && <div className="inv-closing">Every deal here is finished. This link closes on {new Date(view.closesAt).toLocaleDateString()}: download your files and receipts before then.</div>}
      <main className="inv-main">
        <header className="inv-head">
          <span className="inv-mark" aria-hidden />
          <div>
            <small>Agentic Wallet · buyer link</small>
            <h1>{view ? `Hi ${view.name}` : gate ? "Protected link" : error ? "Link unavailable" : "Loading…"}</h1>
            {view && <BuyerNameEditor token={token} name={view.name} onDone={load} />}
            {view && (
              <p>
                <b>{view.sellerName}</b> offers you the deal below. No account needed: pay by card, and your money waits in escrow until you approve the delivery.
              </p>
            )}
          </div>
        </header>
        {error && <p className="inv-error">{error}</p>}
        {gate && <LinkGate key={gate.state} kind={KIND} token={token} state={gate.state} inviter={gate.inviter} onOpen={() => void load()} />}
        {msg && <p className={msg.ok ? "inv-ok" : "inv-error"}>{msg.text}</p>}
        {view && view.deals.length === 0 && <p className="inv-muted">No offer yet. The seller&apos;s offer appears here as soon as they send it.</p>}
        {view?.deals.map((d) => (
          <section className="inv-card" key={d.id}>
            <small>DEAL D-{d.id}</small>
            <h2>
              {d.title} · {money(d.total)}
            </h2>
            {d.summary && <p className="inv-muted">{d.summary}</p>}
            <DealFileLinks base={base} dealId={d.id} files={d.files ?? []} from={view.sellerName} />
            {d.shipTo && <p className="inv-muted">Ship to: {d.shipTo}</p>}
            {d.milestones.map((m) => (
              <div className="inv-milestone" key={m.index}>
                <div>
                  <b>
                    {m.index + 1}. {m.name}
                  </b>
                  <span>{money(m.amount)}</span>
                </div>
                {m.acceptance && <small>To be approved: {m.acceptance}</small>}
                <DueControl
                  due={m.due ?? null}
                  role="buyer"
                  editable={d.status !== "Cancelled" && m.status === "Pending"}
                  onAction={async (action, date) => {
                    const r = await fetch(`${base}/due`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dealId: d.id, action, index: m.index, date }) });
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
                    await load();
                  }}
                />
                <small className="inv-step">{d.status === "Proposed" ? "Waiting for your payment" : (STEP[m.status] ?? m.status)}</small>
                {m.delivery?.note && <small>Seller&apos;s note: {m.delivery.note}</small>}
                {m.delivery?.parcel && (
                  <small>
                    {m.delivery.parcel.carrierLabel} · {m.delivery.parcel.tracking} · {m.delivery.parcel.status}
                  </small>
                )}
                {(m.delivery?.mime?.startsWith("image/") || isPdfDelivery(m.delivery ?? null)) && !["KeyReleased", "Released"].includes(m.status) && (
                  <div className="inv-preview aw-protect">
                    {isPdfDelivery(m.delivery ?? null) ? (
                      <PdfPagePreview base={`${base}/preview/${d.id}/${m.index}`} alt={`Watermarked preview of ${m.delivery?.fileName ?? "the delivery"}`} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${base}/preview/${d.id}/${m.index}`} alt={`Watermarked preview of ${m.delivery?.fileName ?? "the delivery"}`} loading="lazy" />
                    )}
                    <small>Watermarked, reduced preview. The original file unlocks once you approve.</small>
                  </div>
                )}
                {m.delivery?.fileName && !m.delivery.mime?.startsWith("image/") && !isPdfDelivery(m.delivery) && !["KeyReleased", "Released"].includes(m.status) && (
                  <small>File delivered: {m.delivery.fileName} (no preview for this file type; it unlocks once you approve)</small>
                )}
                {m.hasFile && ["KeyReleased", "Released"].includes(m.status) && (
                  <FileLink className="inv-download" href={`${base}/files/${d.id}/${m.index}`} name={m.delivery?.fileName ?? "file"} mime={isPdfDelivery(m.delivery ?? null) ? "application/pdf" : (m.delivery?.mime ?? "")} />
                )}
                {m.canApprove && (
                  <button type="button" className="inv-primary" disabled={!!busy} onClick={() => void approve(d, m)}>
                    {busy === `ok${d.id}:${m.index}` ? "Approving…" : `Approve · pay ${money(m.amount)}`}
                  </button>
                )}
              </div>
            ))}
            {(d.canPay || d.guarantor) && view && (
              <GuarantorForm
                current={d.guarantor ?? null}
                required={Boolean(d.guarantorRequired)}
                currency={view.currency}
                save={async (g) => {
                  await call(`${base}/guarantor`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...g, dealId: d.id }) });
                  await load();
                }}
              />
            )}
            {d.canPay && d.offerExpiresAt && <p className="inv-muted">⏳ Pay by {new Date(d.offerExpiresAt).toLocaleDateString()}: an offer not signed within 14 days is withdrawn.</p>}
            {d.canPay && (
              <button type="button" className="inv-primary" disabled={!!busy} onClick={() => void pay(d)}>
                {busy === `pay${d.id}` ? "Opening the payment…" : `Pay ${money(d.total)} by card`}
              </button>
            )}
          </section>
        ))}
        {view && (
          <section className="inv-card inv-app">
            <p className="inv-muted">No account needed to pay here. Want your own Agentic Wallet to hire and get paid with escrow?</p>
            <div className="inv-actions">
              <Link className="inv-linkbtn" href="/login?mode=login&next=%2Fchat">
                Open the app
              </Link>
            </div>
          </section>
        )}
        {view && (
          <p className="inv-foot">
            This link is your key to these deals; keep it private. It expires on {new Date(view.expiresAt).toLocaleDateString()}. Your money is held by an escrow smart contract until
            you approve each delivery.
          </p>
        )}
      </main>
    </div>
  );
}
