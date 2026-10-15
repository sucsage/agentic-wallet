"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";

import { api, tokenMoney, useAppData } from "./app-data";
import { Button, Loading } from "./mockup-ui";

/**
 * Wallet-style top-up (like a mobile wallet's "Top up" screen): pick an amount, pick a channel.
 *   PromptPay QR and card → Stripe Checkout (test mode), confirmed with Stripe on return
 *   Linked card → one tap, charged off-session, no redirect
 *   Counter service → a demo payment slip; the cashier's scan is simulated
 */

type Info = {
  currency: "THB" | "CNY";
  limit: number;
  enabled: boolean;
  card: { brand: string; last4: string } | null;
  history: { amount: number; at: string; channel: string }[];
};
type Method = "promptpay" | "card" | "linked" | "counter";
type Slip = { ref: string; slip: string; amount: number; currency: string; expiresAt: string; qr: string };

const CHIPS = { THB: [100, 300, 500, 1000], CNY: [20, 50, 100, 200] } as const;
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function TopUpSheet({ currency, onClose }: { currency: "THB" | "CNY"; onClose: () => void }) {
  const { me, refresh } = useAppData();
  const [info, setInfo] = useState<Info | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>(currency === "THB" ? "promptpay" : "card");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [slip, setSlip] = useState<Slip | null>(null);
  const account = me?.accounts.find((a) => a.isDefault) ?? me?.accounts[0];
  const load = () => api<Info>("/api/bank/topup").then(setInfo).catch(() => setInfo(null));
  useEffect(() => {
    void load();
  }, []);

  const value = Number(amount);
  const methods: { id: Method; icon: string; title: string; sub: string; disabled?: string }[] = [
    { id: "promptpay", icon: "▦", title: "PromptPay QR", sub: "Scan with any Thai bank app", disabled: currency !== "THB" ? "Baht accounts only" : undefined },
    { id: "card", icon: "💳", title: "Credit / debit card", sub: "Visa, Mastercard" },
    {
      id: "linked",
      icon: "⚡",
      title: info?.card ? `${info.card.brand.toUpperCase()} ••${info.card.last4}` : "Linked card",
      sub: info?.card ? "One tap, no redirect" : "Link a card on the Profile page",
      disabled: info && !info.card ? "Not linked" : undefined,
    },
    { id: "counter", icon: "🏪", title: "Counter service", sub: "Pay at a convenience store with a slip (demo)" },
  ];

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      if (method === "promptpay" || method === "card") {
        const { url } = await api<{ url: string }>("/api/bank/topup", json({ amount: value, method }));
        window.location.assign(url);
        return;
      }
      if (method === "linked") {
        const r = await api<{ amount: number; card: string }>("/api/bank/topup/linked", json({ amount: value, requestId: crypto.randomUUID() }));
        setMsg({ ok: true, text: `✓ ${tokenMoney(r.amount, currency)} added from ${r.card}` });
        setAmount("");
        await Promise.all([refresh(), load()]);
      } else {
        const s = await api<Omit<Slip, "qr">>("/api/bank/topup/counter", json({ amount: value }));
        setSlip({ ...s, qr: await QRCode.toDataURL(s.ref, { margin: 1, width: 180 }) });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function paySlip() {
    if (!slip) return;
    setBusy(true);
    try {
      const r = await api<{ amount: number }>("/api/bank/topup/counter/pay", json({ slip: slip.slip }));
      setMsg({ ok: true, text: `✓ ${tokenMoney(r.amount, currency)} paid in at the counter (ref ${slip.ref})` });
      setSlip(null);
      setAmount("");
      await Promise.all([refresh(), load()]);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const tooLow = value > 0 && value < (currency === "THB" ? 20 : 5);
  const tooHigh = info !== null && value > info.limit;
  return createPortal(
    <div className="aw-debit-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section className="aw-topup-sheet" role="dialog" aria-modal="true" aria-labelledby="aw-topup-title">
        <header>
          <div>
            <h2 id="aw-topup-title">Top up</h2>
            <small>
              {account ? `${account.label} ${account.accountNo}` : "…"} · balance {account ? tokenMoney(Number(account.balance) / 100, currency) : "…"}
            </small>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy}>
            ×
          </button>
        </header>
        {!info && <Loading text="Loading top-up options…" />}
        {slip ? (
          <div className="aw-topup-slip">
            <small>COUNTER SERVICE · PAYMENT SLIP (demo)</small>
            <b>{tokenMoney(slip.amount, currency)}</b>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={slip.qr} alt={`Payment code ${slip.ref}`} width={160} height={160} />
            <code>{slip.ref}</code>
            <small>Show this at the counter within 24 hours. In the demo, the cashier&apos;s scan is simulated.</small>
            <div className="aw-topup-actions">
              <Button variant="outline" disabled={busy} onClick={() => setSlip(null)}>
                Back
              </Button>
              <Button disabled={busy} onClick={() => void paySlip()}>
                {busy ? "Paying in…" : "Simulate paying at the counter"}
              </Button>
            </div>
          </div>
        ) : (
          info && (
            <>
              <label className="aw-topup-amount">
                <span>Amount</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0" aria-label="Amount" />
                <i>{currency === "THB" ? "฿" : "¥"}</i>
              </label>
              <div className="aw-topup-chips">
                {CHIPS[currency].map((c) => (
                  <button type="button" key={c} className={value === c ? "active" : ""} onClick={() => setAmount(String(c))}>
                    {tokenMoney(c, currency)}
                  </button>
                ))}
              </div>
              <small className={tooHigh ? "aw-bank-error" : "aw-topup-note"}>
                {tooLow ? `Minimum ${currency === "THB" ? "฿20" : "¥5"}` : `Up to ${tokenMoney(info.limit, currency)} per top-up`}
              </small>
              <div className="aw-topup-methods" role="radiogroup" aria-label="Top-up channel">
                {methods.map((m) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={method === m.id}
                    key={m.id}
                    disabled={Boolean(m.disabled)}
                    className={method === m.id ? "active" : ""}
                    onClick={() => setMethod(m.id)}
                  >
                    <i aria-hidden="true">{m.icon}</i>
                    <span>
                      <b>{m.title}</b>
                      <small>{m.disabled ?? m.sub}</small>
                    </span>
                  </button>
                ))}
              </div>
              <Button disabled={busy || !value || tooLow || tooHigh || (!info.enabled && method !== "counter")} onClick={() => void go()}>
                {busy ? "…" : `Top up ${value ? tokenMoney(value, currency) : ""}`}
              </Button>
              <small className="aw-topup-note">Test mode: no real money. Card 4242 4242 4242 4242; PromptPay is approved on Stripe&apos;s test page.</small>
            </>
          )
        )}
        {msg && <p className={msg.ok ? "aw-live-ok" : "aw-bank-error"}>{msg.text}</p>}
        {info && info.history.length > 0 && !slip && (
          <div className="aw-topup-history">
            <small>Recent top-ups</small>
            {info.history.slice(0, 5).map((h, i) => (
              <p key={i}>
                <span>
                  {h.channel}
                  <i>{new Date(h.at).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</i>
                </span>
                <b>+{tokenMoney(h.amount, currency)}</b>
              </p>
            ))}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
