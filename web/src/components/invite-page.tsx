"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useState } from "react";

import { DisputeFlow, type DisputeFlowData, isStagedDispute } from "./dispute-flow";
import "./invite.css";

/**
 * The page an invited seller opens from the buyer's link: no account, no sign-in. They accept the
 * offer, deliver the work with their evidence, and choose where their money goes (Mock Bank
 * account, PromptPay id or QR, or another bank). Everything else runs on its own.
 */

type Milestone = {
  index: number;
  name: string;
  acceptance: string | null;
  amount: string;
  hasFile: boolean;
  status: string;
  deadline: number;
  canDeliver: boolean;
  delivery: { note: string; fileName: string | null; sha256: string } | null;
  dispute: ({ reason: string; status: string; decision: string | null; confidence: number | null; rationale: string | null; txHash: string | null } & Partial<DisputeFlowData>) | null;
};

type Deal = {
  id: number;
  status: string;
  total: string;
  reviewHours: number;
  title: string;
  summary: string | null;
  canAccept: boolean;
  milestones: Milestone[];
};

type View = {
  name: string;
  buyerName: string;
  currency: "THB" | "CNY";
  expiresAt: string;
  sellerWallet: string;
  earned: string;
  sent: string;
  payout: { method: string; target: string; bank: string | null; name: string; setAt: string } | null;
  deals: Deal[];
  /** Bank payouts through Opn Payments (test mode). */
  opn: { active: boolean | null; transfers: { amount: string; status: string; id: string | null; error: string | null; at: string }[] } | null;
};

const SIGN = { THB: "฿", CNY: "¥" } as const;
const BANKS = ["BBL", "KBANK", "KTB", "SCB", "BAY", "TTB", "GSB", "BAAC", "UOB", "CIMBT", "KKP", "LH", "TISCO", "GHB"];

const STEP: Record<string, string> = {
  Pending: "Your turn: deliver the work",
  Delivered: "Delivered · the buyer is reviewing",
  Approved: "Approved · releasing your file to the buyer",
  KeyReleased: "File released · payment on its way",
  Released: "Paid",
  Disputed: "Disputed · a neutral arbiter decides",
  Refunded: "Refunded to the buyer",
  Split: "Split by the arbiter · your share is paid",
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function InvitePage({ token }: { token: string }) {
  const base = `/api/invite/${token}`;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await call<View>(base));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);

  useEffect(() => {
    // Fetching on mount and polling is the point: the deal moves on its own (key release, payout).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [load]);

  const money = (amount: string | number, minor = false) => {
    const n = minor ? Number(amount) / 100 : Number(amount);
    return `${view ? SIGN[view.currency] : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="inv-page">
      <div className="inv-banner">DEMO · simulated money · do not enter real bank details you care about</div>
      <main className="inv-main">
        <header className="inv-head">
          <span className="inv-mark" aria-hidden />
          <div>
            <small>Agentic Wallet · seller link</small>
            <h1>{view ? `Hi ${view.name}` : error ? "Link unavailable" : "Loading…"}</h1>
            {view && (
              <p>
                <b>{view.buyerName}</b> wants to hire you. No account needed: accept, deliver, get paid to your bank or PromptPay.
              </p>
            )}
          </div>
        </header>
        {error && <p className="inv-error">{error}</p>}

        {view && (
          <>
            <section className="inv-card inv-earn">
              <div>
                <small>Earned</small>
                <strong>{money(view.earned, true)}</strong>
              </div>
              <div>
                <small>Sent to your account</small>
                <strong>{money(view.sent, true)}</strong>
              </div>
            </section>

            <PayoutCard base={base} view={view} onDone={load} />

            {view.deals.length === 0 && <p className="inv-muted">No offer yet. The buyer&apos;s offer appears here as soon as they lock the money.</p>}
            {view.deals.map((d) => (
              <DealCard key={d.id} base={base} deal={d} money={money} onDone={load} />
            ))}
            <p className="inv-foot">
              This link is your key to these deals; keep it private. It expires on {new Date(view.expiresAt).toLocaleDateString()}. Your
              money is held by an escrow smart contract until the buyer approves each delivery.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function DealCard({ base, deal, money, onDone }: { base: string; deal: Deal; money: (a: string) => string; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function accept() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ outcome: { status: string; error?: string } }>(`${base}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "accept", dealId: deal.id }),
      });
      if (r.outcome.status !== "success") setMsg(r.outcome.error ?? r.outcome.status);
      await onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="inv-card">
      <div className="inv-deal-top">
        <small>DEAL D-{deal.id}</small>
        <span className={`inv-pill ${deal.status === "Active" ? "ok" : ""}`}>{deal.status === "Proposed" ? "Offer" : deal.status}</span>
      </div>
      <h2>
        {deal.title} · {money(deal.total)}
      </h2>
      {deal.summary && <p className="inv-muted">{deal.summary}</p>}
      {deal.canAccept && (
        <div className="inv-accept">
          <p>
            The buyer already locked <b>{money(deal.total)}</b> in escrow. Accepting agrees to the terms below; the buyer has {deal.reviewHours} h
            to review each delivery.
          </p>
          <button className="inv-btn" disabled={busy} onClick={accept}>
            {busy ? "Accepting…" : "Accept the offer"}
          </button>
        </div>
      )}
      {msg && <p className="inv-error">{msg}</p>}
      {deal.milestones.map((m) => (
        <div className="inv-ms" key={m.index}>
          <div className="inv-ms-head">
            <b>
              {m.index + 1}. {m.name}
            </b>
            <span>{money(m.amount)}</span>
          </div>
          {m.acceptance && <small className="inv-muted">To be approved: {m.acceptance}</small>}
          <small className={m.status === "Released" ? "inv-ok" : "inv-step"}>{deal.status === "Active" ? STEP[m.status] ?? m.status : "Starts once you accept"}</small>
          {m.delivery && (
            <small className="inv-muted">
              Delivered: {m.delivery.fileName ?? "evidence only"} · sha256 {m.delivery.sha256.slice(0, 12)}… on-chain
            </small>
          )}
          {m.dispute && isStagedDispute(m.dispute) && (
            <DisputeFlow
              d={m.dispute as DisputeFlowData}
              role="seller"
              amount={m.amount}
              money={(n) => money(n.toFixed(2))}
              onReply={async (reply, statement) => {
                await call(`${base}/dispute`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ dealId: deal.id, index: m.index, reply, statement }),
                });
                await onDone();
              }}
            />
          )}
          {m.dispute && !isStagedDispute(m.dispute) && (
            <div className="inv-dispute">
              <small className="inv-label">⚖ DISPUTE · NEUTRAL ARBITER</small>
              <small>Buyer&apos;s reason: {m.dispute.reason}</small>
              {m.dispute.decision ? (
                <small className={m.dispute.decision === "seller" ? "inv-ok" : "inv-error"}>
                  {m.dispute.status === "RESOLVED" ? "Ruling" : "Recommendation"}: {m.dispute.decision === "seller" ? "you are paid" : "the buyer is refunded"}
                  {m.dispute.confidence !== null && ` · ${Math.round(m.dispute.confidence * 100)}% confident`} · {m.dispute.rationale}
                </small>
              ) : (
                <small className="inv-step">The arbiter is comparing your evidence with the acceptance criteria…</small>
              )}
            </div>
          )}
          {m.canDeliver && <Deliver base={base} dealId={deal.id} index={m.index} again={Boolean(m.delivery)} onDone={onDone} />}
        </div>
      ))}
    </section>
  );
}

function Deliver({ base, dealId, index, again, onDone }: { base: string; dealId: number; index: number; again: boolean; onDone: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (file && file.size > 4 * 1024 * 1024) return setMsg({ ok: false, text: "The file is larger than 4 MB" });
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("dealId", String(dealId));
      form.set("index", String(index));
      form.set("note", note);
      if (file) form.set("file", file);
      const r = await call<{ outcome: { status: string; error?: string }; sha256: string }>(`${base}/deliver`, { method: "POST", body: form });
      if (r.outcome.status !== "success") setMsg({ ok: false, text: r.outcome.error ?? r.outcome.status });
      else {
        setMsg({ ok: true, text: `Delivered · sha256 ${r.sha256.slice(0, 12)}… recorded on-chain` });
        setNote("");
        setFile(null);
      }
      await onDone();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="inv-form" onSubmit={submit}>
      <label>
        <span>{again ? "Deliver again (replaces the previous delivery)" : "Evidence: what you delivered and how it meets the criteria"}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000} required />
      </label>
      <label>
        <span>File (optional, max 4 MB · encrypted; the buyer unlocks it after approving)</span>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <button className="inv-btn" type="submit" disabled={busy || !note.trim()}>
        {busy ? "Encrypting & recording…" : "Submit delivery"}
      </button>
      {msg && <p className={msg.ok ? "inv-ok" : "inv-error"}>{msg.text}</p>}
    </form>
  );
}

type Method = "PROMPTPAY" | "QR" | "MOCKBANK" | "BANK";

/** Reads a QR code from a photo or screenshot in the browser; the image never leaves the device. */
async function readQr(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(img.data, img.width, img.height);
  if (!code) throw new Error("No QR code found in this image");
  return code.data;
}

function PayoutCard({ base, view, onDone }: { base: string; view: View; onDone: () => Promise<void> }) {
  const [method, setMethod] = useState<Method>(view.currency === "THB" ? "PROMPTPAY" : "MOCKBANK");
  const [target, setTarget] = useState("");
  const [bank, setBank] = useState("KBANK");
  const [name, setName] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (view.payout) {
    const p = view.payout;
    const how = p.method === "PROMPTPAY" ? "PromptPay" : p.method === "BANK" ? `${p.bank} account` : "Mock Bank account";
    return (
      <section className="inv-card">
        <small className="inv-label">PAYOUT · LOCKED</small>
        <p>
          Paid to <b>{how}</b> {p.target} · {p.name}
        </p>
        <small className="inv-muted">
          Set on {new Date(p.setAt).toLocaleString()}. It cannot be changed through this link, so a leaked link cannot redirect your money.
        </small>
        {view.opn && (
          <div className="inv-opn">
            <small className="inv-label">BANK TRANSFER · OPN PAYMENTS (TEST MODE)</small>
            {view.opn.active === false && <p className="inv-muted">⏳ Waiting for the payment provider to approve this bank account. Earnings wait safely until then.</p>}
            {view.opn.active && <p className="inv-ok">✓ Bank account approved for transfers</p>}
            {view.opn.transfers.map((t, i) => (
              <p key={i} className="inv-opn-row">
                <b>{(Number(t.amount) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} THB</b>
                <span>
                  {t.status === "PAID" ? "✓ Paid" : t.status === "SENDING" ? "Sending…" : t.status === "FAILED" ? "Retrying" : "Waiting"}
                  {t.id ? ` · ${t.id}` : ""}
                </span>
                {t.error && t.status !== "PAID" && <small className="inv-muted">{t.error}</small>}
              </p>
            ))}
          </div>
        )}
      </section>
    );
  }

  async function pickQr(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    try {
      setQr(await readQr(file));
    } catch (e) {
      setQr(null);
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const body =
      method === "PROMPTPAY"
        ? { method, promptPayId: target, name }
        : method === "QR"
          ? { method: "PROMPTPAY", qr, name }
          : method === "BANK"
            ? { method, bank, accountNo: target, name }
            : { method, accountNo: target, name };
    try {
      const r = await call<{ payoutName: string }>(`${base}/payout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setMsg({ ok: true, text: `Saved · payee ${r.payoutName}` });
      await onDone();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: Method; label: string }[] = [
    ...(view.currency === "THB"
      ? [
          { id: "PROMPTPAY" as const, label: "PromptPay" },
          { id: "QR" as const, label: "PromptPay QR" },
        ]
      : []),
    { id: "MOCKBANK", label: "Mock Bank account" },
    ...(view.currency === "THB" ? [{ id: "BANK" as const, label: "Other bank" }] : []),
  ];

  return (
    <section className="inv-card">
      <small className="inv-label">WHERE SHOULD WE PAY YOU?</small>
      <p className="inv-muted">You can set this once. Payments wait safely until you do.</p>
      <div className="inv-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={method === t.id}
            className={method === t.id ? "on" : ""}
            onClick={() => {
              setMethod(t.id);
              setTarget("");
              setQr(null);
              setMsg(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <form className="inv-form" onSubmit={save}>
        {method === "PROMPTPAY" && (
          <label>
            <span>Mobile number, 13-digit citizen id or e-wallet id</span>
            <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric" placeholder="08x-xxx-xxxx" required />
          </label>
        )}
        {method === "QR" && (
          <label>
            <span>Photo or screenshot of your PromptPay QR (read on this device)</span>
            <input type="file" accept="image/*" onChange={(e) => void pickQr(e.target.files?.[0])} />
            {qr && <small className="inv-ok">QR read ✓</small>}
          </label>
        )}
        {method === "BANK" && (
          <>
            <label>
              <span>Bank</span>
              <select value={bank} onChange={(e) => setBank(e.target.value)}>
                {BANKS.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Account number</span>
              <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric" required />
            </label>
          </>
        )}
        {method === "MOCKBANK" && (
          <label>
            <span>Mock Bank account number (the full number from your passbook)</span>
            <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric" placeholder="999-x-xxxxx-x" required />
          </label>
        )}
        <label>
          <span>Account holder&apos;s name{method === "MOCKBANK" ? " (must match the account)" : ""}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        {method === "BANK" && <small className="inv-muted">Paid by real bank transfer through Opn Payments in test mode (no real money). A new bank account is approved by the payment provider first.</small>}
        {method !== "MOCKBANK" && method !== "BANK" && <small className="inv-muted">Demo: PromptPay transfers are simulated.</small>}
        <button className="inv-btn" type="submit" disabled={busy || !name.trim() || (method === "QR" ? !qr : !target.trim())}>
          {busy ? "Checking…" : "Save payout account"}
        </button>
        {msg && <p className={msg.ok ? "inv-ok" : "inv-error"}>{msg.text}</p>}
      </form>
    </section>
  );
}
