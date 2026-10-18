"use client";

import jsQR from "jsqr";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { acceptAttr, fileTypeOk, fileTypesLabel } from "@/lib/file-types";

import { DisputeFlow, type DisputeFlowData, isStagedDispute } from "./dispute-flow";
import { DealFileLinks } from "./deal-file-links";
import { CaptureGuard } from "./capture-guard";
import { GuarantorForm } from "./guarantor-form";
import { LinkGate } from "./link-gate";
import "./invite.css";

const KIND = "invite" as const;

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
  fileTypes?: string[];
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
  offerExpiresAt?: string | null;
  guarantorRequired?: boolean;
  guarantor?: { name: string; contact: string; relation: string; amount: number | null } | null;
  files?: { id: string; name: string; mime: string; size: number }[];
  milestones: Milestone[];
  notes?: { kind: string; index: number | null; text: string; at: string }[];
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
  /** Opened signed in: the invite is linked to that account (earnings to its wallet). */
  linked?: { toYou: boolean; signedIn: boolean; error: string | null };
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

/** The buyer typed the seller's name when inviting: the seller can write their own. */
function NameEditor({ base, name, onDone }: { base: string; name: string; onDone: () => Promise<void> }) {
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
          await call(`${base}/name`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: value }) });
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
        Your name (shown to the buyer)
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

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(body?.error ?? `Request failed (${res.status})`), { linkAccess: body?.linkAccess as string | undefined });
  return body as T;
}

export function InvitePage({ token }: { token: string }) {
  const base = `/api/invite/${token}`;
  const [gate, setGate] = useState<{ state: "otp" | "password"; inviter: string } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    // Fetching on mount and polling is the point: the deal moves on its own (key release, payout).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [load]);

  // Someone with an account (signed in here) goes into the app: the deal is linked to their account
  // and listed on their Deals page. An offer waiting for them is accepted here first (the button
  // below), then the app opens. "?stay=1" (the link from that page) stays here.
  const linkedToYou = Boolean(view?.linked?.toYou);
  const offerWaiting = Boolean(view?.deals.some((d) => d.canAccept));
  const stay = typeof window !== "undefined" && Boolean(new URLSearchParams(window.location.search).get("stay"));
  useEffect(() => {
    if (!linkedToYou || offerWaiting || stay) return;
    const t = setTimeout(() => window.location.replace("/deals?from=link"), 1200);
    return () => clearTimeout(t);
  }, [linkedToYou, offerWaiting, stay]);
  // Accepted from here while linked: open the app with the deal in it.
  const accepted = () => {
    if (linkedToYou && !stay) setTimeout(() => window.location.replace("/deals?from=link"), 1500);
  };

  const money = (amount: string | number, minor = false) => {
    const n = minor ? Number(amount) / 100 : Number(amount);
    return `${view ? SIGN[view.currency] : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="inv-page">
      <CaptureGuard />
      <div className="inv-banner">DEMO · simulated money · do not enter real bank details you care about</div>
      <main className="inv-main">
        <header className="inv-head">
          <span className="inv-mark" aria-hidden />
          <div>
            <small>Agentic Wallet · seller link</small>
            <h1>{view ? `Hi ${view.name}` : gate ? "Protected link" : error ? "Link unavailable" : "Loading…"}</h1>
            {view && <NameEditor base={base} name={view.name} onDone={load} />}
            {view && (
              <p>
                <b>{view.buyerName}</b> wants to hire you.{" "}
                {view.linked?.toYou ? "This deal is linked to your account." : "No account needed: accept, deliver, get paid to your bank or PromptPay."}
              </p>
            )}
          </div>
        </header>
        {error && <p className="inv-error">{error}</p>}
        {gate && <LinkGate key={gate.state} kind={KIND} token={token} state={gate.state} inviter={gate.inviter} onOpen={() => void load()} />}
        {view?.linked?.toYou && (
          <section className="inv-card inv-linked">
            <b>✓ Linked to your Agentic Wallet account</b>
            {offerWaiting ? (
              <p className="inv-muted">
                <b>Accept the offer below first</b>: then the app opens with this deal in it.
              </p>
            ) : (
              !stay && <p className="inv-muted">Opening your account…</p>
            )}
            <p>Earnings go straight into your wallet, {view.buyerName} is now in your contacts, and this deal is listed on your Deals page. Keep working here, or open the app.</p>
            <div className="inv-actions">
              <Link className="inv-linkbtn" href="/deals">
                Open the app
              </Link>
            </div>
          </section>
        )}
        {view?.linked?.error && <p className="inv-muted">Not linked to your account: {view.linked.error}</p>}
        {view && !view.linked?.signedIn && (
          <section className="inv-card inv-app">
            <p className="inv-muted">Already have an Agentic Wallet account? Log in: this deal then links to your account and pays into your wallet. No account? You can keep using this page, or create one.</p>
            <div className="inv-actions">
              <a className="inv-linkbtn" href={`/login?mode=login&next=${encodeURIComponent(`/invite/${token}`)}`}>
                Log in
              </a>
              <a className="inv-linkbtn ghost" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
                Create an account
              </a>
            </div>
          </section>
        )}

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
              <DealCard key={d.id} base={base} deal={d} buyerName={view.buyerName} currency={view.currency} money={money} onDone={load} onAccepted={accepted} />
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

function DealCard({
  base,
  deal,
  buyerName,
  currency,
  money,
  onDone,
  onAccepted,
}: {
  base: string;
  deal: Deal;
  buyerName: string;
  currency: "THB" | "CNY";
  money: (a: string) => string;
  onDone: () => Promise<void>;
  onAccepted?: () => void;
}) {
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
      else {
        setMsg("Accepted ✓ The deal is signed.");
        onAccepted?.();
      }
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
      <DealFileLinks base={base} dealId={deal.id} files={deal.files ?? []} from={buyerName} />
      {deal.notes
        ?.filter((n) => n.kind === "REVISION")
        .map((n, i) => (
          <p key={i} className="inv-step">
            ✎ The buyer asks for a revised offer: “{n.text}”
          </p>
        ))}
      {deal.canAccept && (
        <div className="inv-accept">
          <p>
            The buyer already locked <b>{money(deal.total)}</b> in escrow. Accepting agrees to the terms below; the buyer has {deal.reviewHours} h
            to review each delivery.
          </p>
          <GuarantorForm
            current={deal.guarantor ?? null}
            required={Boolean(deal.guarantorRequired)}
            currency={currency}
            save={async (g) => {
              await call(`${base}/guarantor`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...g, dealId: deal.id }) });
              await onDone();
            }}
          />
          {deal.offerExpiresAt && <p className="inv-muted">⏳ Accept by {new Date(deal.offerExpiresAt).toLocaleDateString()}: an offer not signed within 14 days is withdrawn.</p>}
          <button className="inv-btn" disabled={busy} onClick={accept}>
            {busy ? "Accepting…" : "Accept the offer"}
          </button>
        </div>
      )}
      {msg && <p className={msg.startsWith("Accepted") ? "inv-ok" : "inv-error"}>{msg}</p>}
      {deal.milestones.map((m) => (
        <div className="inv-ms" key={m.index}>
          <div className="inv-ms-head">
            <b>
              {m.index + 1}. {m.name}
            </b>
            <span>{money(m.amount)}</span>
          </div>
          {m.acceptance && <small className="inv-muted">To be approved: {m.acceptance}</small>}
          {deal.notes
            ?.filter((n) => n.kind === "CHANGES" && n.index === m.index)
            .map((n, i) => (
              <small key={i} className="inv-step">
                ✎ The buyer asks for changes: “{n.text}” · deliver the fixed version below
              </small>
            ))}
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
          {m.canDeliver && <Deliver base={base} dealId={deal.id} index={m.index} again={Boolean(m.delivery)} fileTypes={m.fileTypes} onDone={onDone} />}
        </div>
      ))}
    </section>
  );
}

function Deliver({
  base,
  dealId,
  index,
  again,
  fileTypes,
  onDone,
}: {
  base: string;
  dealId: number;
  index: number;
  again: boolean;
  fileTypes?: string[];
  onDone: () => Promise<void>;
}) {
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
        <span>
          File ({fileTypes?.length ? <b>{fileTypesLabel(fileTypes)} only, as agreed</b> : "optional"}, max 4 MB · encrypted; the buyer unlocks it after approving)
        </span>
        <input
          type="file"
          accept={acceptAttr(fileTypes)}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f && !fileTypeOk(f.name, fileTypes)) {
              setMsg({ ok: false, text: `Only ${fileTypesLabel(fileTypes)} files are accepted for this milestone.` });
              e.target.value = "";
              setFile(null);
              return;
            }
            setMsg(null);
            setFile(f);
          }}
        />
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
