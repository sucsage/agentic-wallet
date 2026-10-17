"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { SaveTemplateDialog, type TemplatePayload, TemplatesPanel } from "./deal-templates";
import { ATTACH_ACCEPT, type ChatAttachment, fileToChatAttachment } from "./chat-attach";
import { toast } from "./header-tools";
import { SecurityCard } from "./two-factor";
import { DisplaySizeCard } from "./ui-scale";
import { ChatMarkdown, OpenDealButton, copyText, startDeferredCopy } from "./chat-markdown";
import { PayoutCard, type PayoutPreview } from "./payout-card";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DraftView } from "@/lib/bank/drafts";
import { authClient } from "@/lib/auth-client";
import { localizeMockupNode, useLang } from "@/lib/i18n";

import { type AccountView, api, download, lockedInDeals, money, tokenMoney, useAppData } from "./app-data";
import { Button, Card, Loading, PageTitle } from "./mockup-ui";
import { ActingSwitch, CompaniesPanel, FundCompany } from "./company";
import { DealFormCard, type DealFormData } from "./deal-form";
import { PreferencesCard, alsoIn, usePrefs } from "./prefs";
import { TopUpSheet } from "./topup-sheet";
import type { BankChoice } from "./mockup-screens";

/**
 * The mockup screens wired to the backend: bank sign-in and consent, the balance bar, the AI chat
 * with approvable drafts, the deals list and profile & privacy. Same classes as the mockup, so the
 * Figma look stays; only the data is real.
 */

const WalletIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 6h13a2 2 0 0 1 2 2v12H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
    <path d="M3 8h15M15 13h5v4h-5a2 2 0 0 1 0-4Z" />
  </svg>
);

function defaultAccount(accounts: AccountView[] | undefined) {
  return accounts?.find((a) => a.isDefault && a.linked) ?? accounts?.find((a) => a.linked) ?? null;
}

/** Card top-up through Stripe Checkout (test mode); confirmed with Stripe when the user comes back. */
function TopUp({ currency }: { currency: "THB" | "CNY" }) {
  const { refresh } = useAppData();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const session = new URLSearchParams(window.location.search).get("topup");
    if (!session) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (session === "cancelled") {
      // Reading the redirect's result once on mount is what this effect is for.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMsg({ ok: false, text: "Top-up cancelled" });
      return;
    }
    api<{ status: string; amount: number; currency: string }>("/api/bank/topup/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session }),
    })
      .then((r) => {
        setMsg(r.status === "paid" ? { ok: true, text: `✓ ${tokenMoney(r.amount, currency)} added (Stripe test)` } : { ok: false, text: `Payment ${r.status}` });
        return refresh();
      })
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span className="aw-topup">
      <button type="button" className="aw-topup-button" onClick={() => setOpen(true)}>
        ＋ Top up
      </button>
      {msg && <small className={msg.ok ? "aw-live-ok" : "aw-bank-error"}>{msg.text}</small>}
      {open && <TopUpSheet currency={currency} onClose={() => setOpen(false)} />}
    </span>
  );
}

export function BalanceBar() {
  const { me, wallet, status, refresh } = useAppData();
  const account = defaultAccount(me?.accounts);
  const currency = me?.bank.currency ?? "THB";
  const [funding, setFunding] = useState(false);
  const acting = me?.acting ?? null;
  const [prefs] = usePrefs();
  return (
    <>
    {status === "creating-wallet" && <Loading text="Creating your agent wallet and its keys on-chain (about 10 s)…" />}
    <div className="aw-ai-balancebar">
      <div className="aw-ai-bank">
        <span className="aw-ai-wallet-icon">
          <WalletIcon />
        </span>
        <span>
          <small>
            {acting ? `Company · ${acting.name}` : `${currency} wallet`} · {account?.accountNo ?? "…"}
          </small>
          <b>
            {account ? money(account.balance, currency) : "…"} <i>Available</i>
            {account && prefs?.showAlso && <i className="also">{alsoIn(Number(account.balance) / 100, currency, prefs.showAlso)}</i>}
          </b>
        </span>
      </div>
      <div className="aw-ai-balance-stat">
        <small>Locked in deals</small>
        <b>{tokenMoney(lockedInDeals(wallet), currency)}</b>
      </div>
      <div className="aw-ai-balance-stat">
        <small>Agent limit / day</small>
        <b>{wallet ? tokenMoney(wallet.session.dailyLimit, wallet.token.currency) : "…"}</b>
      </div>
      <div className="aw-ai-balance-actions">
        {acting ? (
          <span className="aw-topup">
            <button type="button" className="aw-topup-button" onClick={() => setFunding(true)}>
              ＋ Add from my wallet
            </button>
            {funding && <FundCompany company={{ id: acting.companyId, name: acting.name, currency }} onDone={() => void refresh()} onClose={() => setFunding(false)} />}
          </span>
        ) : (
          <TopUp currency={currency} />
        )}
        <span className="aw-demo-bank-pill">Test money</span>
      </div>
    </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------
// Bank sign-in, then consent (BankAuthorizeScreen)
// ------------------------------------------------------------------------------------------

type BankAccountsResult = {
  ticket: string;
  customer: { displayName: string; type: "PERSONAL" | "COMPANY" };
  accounts: AccountView[];
};

function errorText(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  return err?.message ?? "Something went wrong";
}

export function BankAuthorizeLive({ bank, onCancel, onContinue }: { bank: BankChoice; onCancel: () => void; onContinue: () => void }) {
  const lang = useLang();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [accountType, setAccountType] = useState<"personal" | "company">("personal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState<BankAccountsResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const chinese = bank === "chinese";
  const currency = chinese ? "CNY" : "THB";

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res =
      mode === "login"
        ? await authClient.mockBank.login({ bank, username, pin })
        : await authClient.mockBank.register({ bank, username, pin, displayName, accountType });
    setBusy(false);
    if (res.error || !res.data) return setError(errorText(res.error));
    const data = res.data as BankAccountsResult;
    setLogin(data);
    setSelected(data.accounts.filter((a) => a.isDefault).map((a) => a.id));
  }

  async function allow() {
    if (!login) return;
    setBusy(true);
    setError(null);
    const res = await authClient.mockBank.authorize({
      ticket: login.ticket,
      accountIds: selected,
      defaultAccountId: login.accounts.find((a) => a.isDefault && selected.includes(a.id))?.id ?? selected[0],
      consent: true,
    });
    setBusy(false);
    if (res.error) {
      // An expired ticket means logging in at the bank again.
      if ((res.error as { code?: string }).code === "TICKET_EXPIRED") setLogin(null);
      return setError(errorText(res.error));
    }
    onContinue();
  }

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return localizeMockupNode(
    <main className={`aw-bank-authorize-page${chinese ? " aw-bank-authorize-chinese" : ""}`}>
      <div className="aw-bank-demo-banner">DEMO BANK · not a real bank · no real money · do not enter real credentials</div>
      <header className="aw-bank-header">
        <div>
          <span className={`aw-bank-header-icon${chinese ? " chinese" : ""}`}>
            <WalletIcon />
          </span>
          <b>Mock Bank · {chinese ? "China" : "Thailand"}</b>
          <small>{currency}</small>
        </div>
        <span className="aw-secure-label">Secure connection</span>
      </header>
      <section className="aw-authorize-card">
        {!login ? (
          <form onSubmit={signIn} className="aw-bank-signin">
            <h1>{mode === "login" ? "Log in to Mock Bank" : "Open a demo bank account"}</h1>
            <div className="aw-account-type-row">
              <small>{mode === "login" ? "New here?" : "Already a customer?"}</small>
              <div role="group" aria-label="Log in or sign up">
                <button type="button" className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")}>
                  Log in
                </button>
                <button type="button" className={mode === "register" ? "selected" : ""} onClick={() => setMode("register")}>
                  New customer
                </button>
              </div>
            </div>
            {mode === "register" && (
              <label className="aw-bank-field">
                <span>Display name</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} required autoComplete="off" />
              </label>
            )}
            <label className="aw-bank-field">
              <span>Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                pattern="[a-z0-9_.]{3,32}"
                title="3-32 letters, digits, _ or ."
                required
                autoComplete="off"
              />
            </label>
            <label className="aw-bank-field">
              <span>6-digit demo PIN (not your real PIN)</span>
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                type="password"
                pattern="\d{6}"
                required
                autoComplete="off"
              />
            </label>
            {mode === "register" && (
              <div className="aw-account-type-row">
                <small>Account type</small>
                <div role="group" aria-label="Account type">
                  <button type="button" className={accountType === "personal" ? "selected" : ""} onClick={() => setAccountType("personal")}>
                    Personal
                  </button>
                  <button type="button" className={accountType === "company" ? "selected" : ""} onClick={() => setAccountType("company")}>
                    Company
                  </button>
                </div>
              </div>
            )}
            {error && <p className="aw-bank-error">{error}</p>}
            <div className="aw-authorize-actions">
              <Button variant="outline" type="button" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "…" : mode === "login" ? "Log in" : "Open account"}
              </Button>
            </div>
            <p className="aw-authorize-footnote">
              A new demo account comes with two passbooks and demo money. Five wrong PINs lock the account for 15 minutes.
            </p>
          </form>
        ) : (
          <>
            <h1>MilestonePay wants to connect to your account</h1>
            <ul className="aw-permissions">
              <li>
                <b>✓</b>See your account balance
              </li>
              <li>
                <b>✓</b>Debit only when you approve a deal (lock)
              </li>
              <li>
                <b>✓</b>Credit payouts and refunds to your account
              </li>
              <li className="denied">
                <b>×</b>Cannot top up, withdraw or move money on its own
              </li>
            </ul>
            <small className="aw-passbook-label">
              Choose passbooks to link · {login.customer.displayName} · {login.customer.type === "COMPANY" ? "Company" : "Personal"}
            </small>
            <div className="aw-passbook-list">
              {login.accounts.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  aria-pressed={selected.includes(a.id)}
                  className={`aw-passbook${selected.includes(a.id) ? " selected" : ""}`}
                  onClick={() => toggle(a.id)}
                >
                  <span className="aw-passbook-check">{selected.includes(a.id) ? "✓" : ""}</span>
                  <span className="aw-passbook-copy">
                    <b>
                      {a.label} {a.accountNo}
                      {a.isDefault && <small className="aw-default-badge">Default</small>}
                    </b>
                    <small>{login.customer.displayName}</small>
                  </span>
                  <strong>{money(a.balance, a.currency)}</strong>
                </button>
              ))}
            </div>
            {error && <p className="aw-bank-error">{error}</p>}
            <div className="aw-authorize-actions">
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button onClick={allow} disabled={busy || selected.length === 0}>
                {busy ? "…" : "Allow & continue"}
              </Button>
            </div>
            <p className="aw-authorize-footnote">
              Only {currency} passbooks are shown because you chose a {chinese ? "Chinese" : "Thai"} bank. Each debit uses an idempotency key, so a
              retry never charges twice.
            </p>
          </>
        )}
      </section>
    </main>,
    lang,
  );
}

// ------------------------------------------------------------------------------------------
// AI chat (CreateDealScreen)
// ------------------------------------------------------------------------------------------

type Step = { tool: string; summary: string; draft?: DraftView; form?: DealFormData; open?: { dealId: number; title: string }; payout?: PayoutPreview };
type ChatItem =
  /** `file`: an attached file's name; `image`: a data URL thumbnail (this session only). */
  | { kind: "user"; text: string; at: string; file?: string; image?: string | null }
  /** `live`: still streaming; `running`: tool calls started but not finished yet. */
  | { kind: "agent"; text: string; at: string; steps: Step[]; live?: boolean; running?: { id: string; tool: string }[] }
  | { kind: "error"; text: string };

/** What the agent is doing, in words, while a tool runs. */
const TOOL_LABEL: Record<string, string> = {
  get_wallet_status: "Checking your wallet, limits and payees",
  deal_templates: "Reading your deal templates",
  amend_deal: "Preparing the change to your deal",
  save_deal_template: "Saving a deal template",
  list_deals: "Reading your deals",
  propose_bank_deal: "Drafting the deal",
  propose_bank_sale: "Drafting the sale offer",
  invite_seller: "Creating a wallet and invite link",
  remember_nickname: "Remembering the nickname",
  ask_deal_details: "Preparing a form for the missing details",
  list_groups: "Reading your groups",
  create_group: "Creating the group",
  propose_to_group: "Putting the draft to the group's vote",
  forget_nickname: "Forgetting the nickname",
  discard_draft: "Discarding the draft",
  pause_wallet: "Pausing the wallet",
  forecast_cashflow: "Forecasting cash flow",
};

/** Reads a Server-Sent Events response, calling `on` for each event. */
async function readEvents(res: Response, on: (event: string, data: unknown) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (data) on(event, JSON.parse(data));
    }
  }
}

const clock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const now = () => clock(new Date());

type SavedChat = { id: string; title: string; updatedAt: string };
type StoredItem =
  | { kind: "user"; text: string; at: string }
  | { kind: "agent"; text: string; at: string; steps: Step[] }
  | { kind: "error"; text: string; at: string };

/** A saved chat back into chat items (times were stored as ISO strings). */
const fromStored = (m: StoredItem): ChatItem =>
  m.kind === "error" ? { kind: "error", text: m.text } : m.kind === "user" ? { ...m, at: clock(new Date(m.at)) } : { ...m, at: clock(new Date(m.at)) };

const LAST_CHAT = "aw-last-chat";
const remember = (id: string | null) => {
  try {
    if (id) localStorage.setItem(LAST_CHAT, id);
    else localStorage.removeItem(LAST_CHAT);
  } catch {
    // storage blocked: the chat still works, it just opens empty next time
  }
};

/**
 * The agent's Tier 2 caps (per transaction, per day), next to the AI agent on the chat page.
 * Saving is an owner transaction on the wallet contract (setSession), so it takes a few seconds.
 */
function LimitsEditor({
  wallet,
  editing,
  setEditing,
  onSaved,
}: {
  wallet: ReturnType<typeof useAppData>["wallet"];
  editing: boolean;
  setEditing: (v: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [perTx, setPerTx] = useState("");
  const [perDay, setPerDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const currency = wallet?.token.currency ?? "THB";
  useEffect(() => {
    if (!editing || !wallet) return;
    // Opening the editor starts from the caps on-chain.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPerTx(String(Number(wallet.session.maxPerTx)));
    setPerDay(String(Number(wallet.session.dailyLimit)));
    setMsg(null);
    // Only when the editor opens (or the wallet first loads): the app re-reads the wallet every few
    // seconds, and that must not overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, !wallet]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/policy/limits", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxPerTx: Number(perTx), dailyLimit: Number(perDay) }),
      });
      await onSaved();
      setEditing(false);
      setMsg({ ok: true, text: "Saved on-chain." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aw-v08-limits">
      <div className="aw-v08-limits-head">
        <small>Your limits</small>
        <button type="button" onClick={() => setEditing(!editing)} disabled={busy || !wallet}>
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>
      {editing ? (
        <form onSubmit={save}>
          <label>
            <span>Per transaction</span>
            <input aria-label="Per transaction limit" type="number" min="1" step="any" value={perTx} onChange={(e) => setPerTx(e.target.value)} />
          </label>
          <label>
            <span>Per day</span>
            <input aria-label="Per day limit" type="number" min="1" step="any" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
          </label>
          <Button type="submit" disabled={busy || !(Number(perTx) > 0) || !(Number(perDay) > 0)}>
            {busy ? "Saving on-chain…" : "Save limits"}
          </Button>
        </form>
      ) : (
        <>
          <p>
            Per transaction <strong>{wallet ? tokenMoney(wallet.session.maxPerTx, currency) : "…"}</strong>
          </p>
          <p>
            Per day <strong>{wallet ? tokenMoney(wallet.session.dailyLimit, currency) : "…"}</strong>
          </p>
        </>
      )}
      {msg && <p className={msg.ok ? "aw-live-ok" : "aw-bank-error"}>{msg.text}</p>}
    </div>
  );
}

/** A draft as a template (everything but the other party), for the Save as template dialog. */
export function templateFromDraft(d: DraftView): TemplatePayload {
  return {
    name: d.title,
    side: d.side,
    kind: d.kind,
    title: d.title,
    summary: d.summary ?? "",
    milestones: d.milestones.map((m) => ({
      name: m.name,
      amount: String(Number(m.amount)),
      delivery: m.delivery ?? (m.hasFile ? "file" : "note"),
      acceptance: m.acceptance ?? "",
      dueDays: m.due ? Math.max(0, Math.round((new Date(m.due).getTime() - new Date(d.createdAt).getTime()) / 86_400_000)) : null,
    })),
  };
}

type FundingResult = { status: string; dealId?: number | string; steps: { step: string; outcome?: { url?: string | null; hash?: string } }[]; error?: string };

export function DraftCard({
  draft,
  currency,
  onApprove,
  onDiscard,
  balance = null,
  company = null,
  busy = false,
  onSaveTemplate,
}: {
  draft: DraftView;
  currency: "THB" | "CNY";
  onApprove: (d: DraftView) => void;
  onDiscard: (d: DraftView) => void;
  /** The wallet balance (major units), for the "balance covers it" check. */
  balance?: number | null;
  /** Drafted as a company: approval goes to its signers. */
  company?: { name: string; threshold: number } | null;
  /** Confirm was pressed and is still running (on-chain steps take a few seconds). */
  busy?: boolean;
  /** Shows "Save as template" (the deal without its other party). */
  onSaveTemplate?: (d: DraftView) => void;
}) {
  const funded = draft.status === "FUNDED";
  if (draft.status === "CANCELLED") {
    return (
      <section className="aw-deal-draft">
        <div className="aw-draft-topline">
          <small>DR-{draft.id.slice(-6).toUpperCase()}</small>
          <span>Discarded</span>
        </div>
        <h2>{draft.title}</h2>
      </section>
    );
  }
  const failed = draft.status === "FAILED";
  const preview = draft.status === "PREVIEW";
  const sell = draft.side === "SELL";
  const who = draft.sellerLabel || `${draft.counterparty.slice(0, 6)}…${draft.counterparty.slice(-4)}`;
  return (
    <section className="aw-deal-draft">
      <div className="aw-draft-topline">
        <small>
          {draft.replacesDealId !== null && !funded ? `CHANGE TO D-${draft.replacesDealId} · ` : ""}
          {preview ? (sell ? "PREVIEW · OFFER TO SELL" : "PREVIEW · DEAL") : sell ? "DRAFT OFFER TO SELL" : "DRAFT DEAL"} · DR-{draft.id.slice(-6).toUpperCase()}
        </small>
        <span>
          {funded
            ? sell
              ? `Offered · deal #${draft.dealId}`
              : `Locked · deal #${draft.dealId}`
            : failed
              ? sell
                ? "Failed · nothing was offered"
                : "Failed · money refunded"
              : preview
                ? "Not created yet · check and confirm"
              : company
                ? `Needs ${company.threshold} signers`
                : "Needs your approval · Tier 1"}
        </span>
      </div>
      <h2>
        {draft.title}
        <span className={`aw-kind-badge ${draft.kind === "GOODS" ? "goods" : "hire"}`}>{draft.kind === "GOODS" ? "BUY · goods" : "HIRE · service"}</span>
      </h2>
      <div className="aw-draft-parties">
        <span>
          {draft.kind === "HIRE" ? (sell ? "Client" : "Contractor") : sell ? "Buyer" : "Seller"}&nbsp; <b>{who}</b>
        </span>
        {!sell && <i className="green">On allow transfer list ✓</i>}
      </div>
      {draft.milestones.map((m, i) => (
        <div className="aw-draft-milestone" key={i}>
          <i>{i + 1}</i>
          <span>
            <b>
              {m.name}
              {m.deposit ? " · 💰 deposit, paid on signing" : (m.delivery ?? (m.hasFile ? "file" : "note")) === "parcel" ? " · 📦 parcel" : m.hasFile ? " · 📎 file" : ""}
            </b>
            <small>{m.due ? `Due ${m.due}` : m.acceptance}</small>
          </span>
          <strong>{tokenMoney(m.amount, currency)}</strong>
        </div>
      ))}
      {draft.shipTo && (
        <div className="aw-draft-milestone">
          <i>📦</i>
          <span>
            <b>Ship to</b>
            <small>{draft.shipTo}</small>
          </span>
        </div>
      )}
      <div className="aw-draft-total">
        <span>Total</span>
        <b>{tokenMoney(draft.total, currency)}</b>
      </div>
      {!funded && !failed && !sell && (
        <div className="aw-draft-checks">
          {balance !== null &&
            (balance >= Number(draft.total) ? (
              <p>
                ✓ <span>Balance covers it ({tokenMoney(balance, currency)} available)</span>
              </p>
            ) : (
              <p className="warn">
                ! <span>Balance is {tokenMoney(Number(draft.total) - balance, currency)} short: top up first, or a linked card covers the rest</span>
              </p>
            ))}
          <p>
            ✓ <span>Locked in escrow, not paid: each milestone is released only after its delivery is approved</span>
          </p>
          <p>
            ✓ <span>Names only: the AI never saw wallet addresses, account numbers or ID numbers</span>
          </p>
        </div>
      )}
      <div className="aw-draft-notice">
        ⓘ &nbsp;
        {preview && "The AI only proposed this: no deal exists until you confirm. "}
        {draft.replacesDealId !== null && !funded && `Confirming withdraws D-${draft.replacesDealId} (not accepted yet${sell ? "" : "; its locked money comes back"}) and replaces it with this, same person and same link. `}
        {draft.milestones[0]?.deposit && !funded && `The deposit (${tokenMoney(draft.milestones[0].amount, currency)}) is paid to ${sell ? "you" : "the seller"} as soon as the offer is accepted. `}
        {company && !sell
          ? `Submitting counts your yes. The total is taken from the ${company.name} account only after ${company.threshold} signers approve.`
          : company && sell
          ? `Submitting counts your yes. Once ${company.threshold} signers approve, the offer goes on-chain in the name of ${company.name}; it locks nothing, and the buyer's payments go into its account.`
          : sell
          ? "Sending puts the offer on-chain and locks nothing. The buyer pays the total from their wallet when they accept; you are paid as each delivery is approved."
          : "Approving takes the total from your wallet balance and locks it in escrow. Each milestone is paid only after you approve its delivery."}
      </div>
      {busy && (
        <div className="aw-draft-busy" role="status" aria-live="polite">
          <i className="aw-spinner" aria-hidden />
          <span>
            {company
              ? "Submitting to the signers…"
              : sell
                ? "Creating the deal and sending the offer on-chain… (about 10 s)"
                : "Creating the deal, debiting and locking in escrow… (about 10–20 s)"}
          </span>
        </div>
      )}
      {!funded && (
        <div className="aw-draft-actions">
          <Button variant="outline" disabled={busy} onClick={() => onDiscard(draft)}>
            Discard
          </Button>
          <Button disabled={busy} aria-busy={busy} onClick={() => onApprove(draft)}>
            {busy ? (
              <>
                <i className="aw-spinner" aria-hidden /> Working…
              </>
            ) : (
              <>
                {preview && (draft.replacesDealId !== null ? `Confirm change to D-${draft.replacesDealId} · ` : "Confirm · ")}
                {failed
                  ? "Try again"
                  : company
                    ? `Submit to ${company.name} signers · ${tokenMoney(draft.total, currency)}`
                    : sell
                      ? `Send offer · ${tokenMoney(draft.total, currency)}`
                      : `Approve & lock ${tokenMoney(draft.total, currency)}`}
              </>
            )}
          </Button>
        </div>
      )}
      {onSaveTemplate && (
        <button type="button" className="aw-draft-template" onClick={() => onSaveTemplate(draft)}>
          ☆ Save as template
        </button>
      )}
    </section>
  );
}

const TIER_TEXT = [
  "Read balance, deals, history",
  "Draft a deal · you approve the debit",
  "Approve small deliveries within limits + allow transfer list",
  "Pause · anyone can, only owner resumes",
];

function chatDate(iso: string) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `Today · ${time}` : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function LiveChat() {
  const lang = useLang();
  const { me, wallet, drafts, refresh, status, error: setupError } = useAppData();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // Saved chats (max 5). chatId null: a new chat, saved when its first message is sent.
  const [chats, setChats] = useState<SavedChat[] | null>(null);
  const [maxChats, setMaxChats] = useState(5);
  const [chatId, setChatId] = useState<string | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [agentOpen, setAgentOpen] = useState(true);
  const [limitsEditing, setLimitsEditing] = useState(false);
  const [attached, setAttached] = useState<{ att: ChatAttachment; url: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [chatPrefs] = usePrefs();
  const aiOff = chatPrefs?.aiChat === false;
  // "New deal" on a contact opens the chat with a message started for them.
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("draft");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (d) setMessage(d.slice(0, 300));
  }, []);
  // On a phone the agent panel sits above the chat: start it collapsed there.
  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setAgentOpen(false);
  }, []);
  // A card linked through Stripe covers a short balance at approval (shown in the debit dialog).
  const [card, setCard] = useState<StripeLinkView["link"]>(null);
  useEffect(() => {
    api<StripeLinkView>("/api/bank/stripe-link").then((v) => setCard(v.link)).catch(() => setCard(null));
  }, []);
  const [confirm, setConfirmState] = useState<DraftView | null>(null);
  // Balance when the dialog opened: after the debit the account refreshes, and "balance after"
  // must not subtract the same deal twice.
  const [balanceAtOpen, setBalanceAtOpen] = useState<number | null>(null);
  const [debiting, setDebiting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  // The dialog can be closed while the debit runs on-chain; the result then lands in the chat.
  const confirmOpen = useRef(false);
  useEffect(() => {
    confirmOpen.current = confirm !== null;
  }, [confirm]);
  const [debitResult, setDebitResult] = useState<FundingResult | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const currency = me?.bank.currency ?? "THB";
  const address = me?.wallets[0]?.address;
  const account = defaultAccount(me?.accounts);
  const name = me?.user.name ?? "";

  useEffect(() => {
    // Braces matter: newer Chromium returns a Promise from scrollIntoView, which useEffect rejects.
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items, busy]);

  // Drafts can change status (approved here or elsewhere); the chat shows the latest copy.
  const latest = (d: DraftView) => drafts.find((x) => x.id === d.id) ?? d;

  async function loadChats() {
    if (!address) return [];
    const r = await api<{ chats: SavedChat[]; max: number }>(`/api/workspace/${address}/chats`);
    setChats(r.chats);
    setMaxChats(r.max);
    return r.chats;
  }

  async function openChat(id: string) {
    if (!address || busy) return;
    setLoadingChat(true);
    try {
      const r = await api<{ id: string; messages: StoredItem[] }>(`/api/workspace/${address}/chats/${id}`);
      setItems(r.messages.map(fromStored));
      setChatId(r.id);
      remember(r.id);
    } catch {
      remember(null);
      setChatId(null);
      setItems([]);
    } finally {
      setLoadingChat(false);
    }
  }

  function newChat() {
    if (busy) return;
    setChatId(null);
    setItems([]);
    remember(null);
  }

  async function removeChat(c: SavedChat) {
    if (!address || busy || !window.confirm(`Delete the chat "${c.title}"? Drafts made in it stay in Deals.`)) return;
    try {
      await api(`/api/workspace/${address}/chats/${c.id}`, { method: "DELETE" });
      if (c.id === chatId) newChat();
      await loadChats();
    } catch (e) {
      setItems((cur) => [...cur, { kind: "error", text: (e as Error).message }]);
    }
  }

  // Load the chat list once the wallet is known, and reopen the chat the user was last in.
  useEffect(() => {
    if (!address) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_CHAT);
    } catch {
      // no storage: start with a new chat
    }
    void loadChats()
      .then((list) => {
        if (last && list.some((c) => c.id === last)) void openChat(last);
      })
      .catch(() => setChats([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const full = chats !== null && chats.length >= maxChats;

  async function pickFile(file: File | null | undefined) {
    if (!file) return;
    try {
      const att = await fileToChatAttachment(file);
      setAttached({ att, url: att.kind === "image" ? `data:${att.mediaType};base64,${att.base64}` : null });
    } catch (e) {
      setItems((cur) => [...cur, { kind: "error", text: (e as Error).message }]);
    }
  }

  async function send(text: string) {
    const att = attached;
    if ((!text.trim() && !att) || !address || busy) return;
    if (!chatId && full) {
      setItems((cur) => [...cur, { kind: "error", text: `You have ${maxChats} chats. Delete one to start a new chat.` }]);
      return;
    }
    setItems((cur) => [
      ...cur,
      { kind: "user", text: text.trim(), at: now(), file: att?.att.name, image: att?.url },
      { kind: "agent", text: "", at: now(), steps: [], live: true, running: [] },
    ]);
    setMessage("");
    setAttached(null);
    setBusy(true);
    // Updates the agent message being streamed (always the last item).
    const patch = (fn: (m: Extract<ChatItem, { kind: "agent" }>) => Extract<ChatItem, { kind: "agent" }>) =>
      setItems((cur) => {
        const last = cur[cur.length - 1];
        return last?.kind === "agent" && last.live ? [...cur.slice(0, -1), fn(last)] : cur;
      });
    const fail = (msg: string) =>
      setItems((cur) => {
        const last = cur[cur.length - 1];
        const rest = last?.kind === "agent" && last.live && !last.text && last.steps.length === 0 ? cur.slice(0, -1) : cur;
        return [...rest.map((i) => (i.kind === "agent" && i.live ? { ...i, live: false, running: [] } : i)), { kind: "error", text: msg }];
      });
    try {
      const res = await fetch(`/api/workspace/${address}/agent`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ message: text.trim(), lang, chatId: chatId ?? "new", attachment: att?.att }),
      });
      if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      let drafted = false;
      await readEvents(res, (event, data) => {
        const d = data as Record<string, unknown>;
        if (event === "chat") {
          const id = String(d.id);
          setChatId(id);
          remember(id);
        } else if (event === "turn") patch((m) => ({ ...m, text: "" }));
        else if (event === "text") patch((m) => ({ ...m, text: m.text + String(d.delta) }));
        else if (event === "tool") patch((m) => ({ ...m, running: [...(m.running ?? []), { id: String(d.id), tool: String(d.name) }] }));
        else if (event === "step") {
          const step = d.step as Step;
          drafted ||= Boolean(step.draft);
          patch((m) => ({ ...m, steps: [...m.steps, step], running: (m.running ?? []).filter((r) => r.id !== d.id) }));
        } else if (event === "done") patch((m) => ({ ...m, text: String(d.reply), steps: d.steps as Step[], live: false, running: [] }));
        else if (event === "error") fail(String(d.error));
      });
      if (drafted) void refresh();
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setBusy(false);
      void loadChats().catch(() => {});
    }
  }

  const [templateFrom, setTemplateFrom] = useState<TemplatePayload | null>(null);
  const saveAsTemplate = (d: DraftView) => setTemplateFrom(templateFromDraft(d));

  async function discard(d: DraftView) {
    if (!address) return;
    try {
      await api(`/api/workspace/${address}/drafts/${d.id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setItems((cur) => [...cur, { kind: "error", text: (e as Error).message }]);
    }
  }

  async function approve(d: DraftView) {
    if (!address) return;
    // A person without an account gets a private link on Confirm: the copy starts inside this click.
    const copy = /link made on Confirm\)$/.test(d.sellerLabel) ? startDeferredCopy() : null;
    setApprovingId(d.id);
    setDebiting(true);
    setDebitResult(null);
    try {
      const res = await api<{
        draft: DraftView;
        funding?: FundingResult;
        companyVote?: { status: string; yes: number; threshold: number; company: string };
        invite?: { kind: "seller" | "buyer"; name: string; link: string | null } | null;
      }>(`/api/workspace/${address}/drafts/${d.id}/approve`, { method: "POST" });
      if (res.invite?.link) {
        const inv = res.invite;
        const dealNo = res.draft.dealId;
        // Copied by the write the Confirm click started (or a plain copy); the message keeps a Copy button too.
        copy?.resolve(inv.link!);
        const copied = copy ? await copy.done : await copyText(inv.link!);
        toast(copied ? { text: `Private link for ${inv.name} copied to your clipboard`, tone: "ok" } : { text: `Private link for ${inv.name} is ready: press Copy link in the chat`, tone: "info" });
        setItems((cur) => [
          ...cur,
          {
            kind: "agent",
            at: now(),
            steps: [],
            text: `${copied ? "✓ **Copied to your clipboard.** " : ""}Private ${inv.kind} link for **${inv.name}** (send it to them; it is also on the deal's page${dealNo !== null ? `, D-${dealNo}` : ""}):\n\n${inv.link}`,
          },
        ]);
      }
      if (res.companyVote) {
        const v = res.companyVote;
        setItems((cur) => [
          ...cur,
          {
            kind: "agent",
            at: now(),
            steps: [],
            text:
              v.status === "EXECUTED"
                ? `${v.company}'s signers approved: the deal is locked from the company account.`
                : `Submitted to ${v.company}'s signers: ${v.yes} of ${v.threshold} approvals so far. It locks from the company account when ${v.threshold} signers approve (on the group's page under Groups).`,
          },
        ]);
        await refresh();
        return;
      }
      const funding = res.funding;
      if (!funding) throw new Error("No funding result");
      setDebitResult(funding);
      if (d.side !== "SELL" && !confirmOpen.current) {
        setItems((cur) => [
          ...cur,
          funding.status === "FUNDED"
            ? { kind: "agent", at: now(), steps: [], text: `**${d.title}** is locked in escrow${funding.dealId != null ? ` as D-${funding.dealId}` : ""}.` }
            : { kind: "error", text: `${d.title}: ${funding.error ?? funding.status}` },
        ]);
      }
      if (d.side === "SELL" && funding.status !== "FUNDED") {
        setItems((cur) => [...cur, { kind: "error", text: `The offer was not sent: ${funding.error ?? funding.status}` }]);
      }
      await refresh();
    } catch (e) {
      setDebitResult({ status: "ERROR", steps: [], error: (e as Error).message });
      if (d.side === "SELL" || !confirmOpen.current) setItems((cur) => [...cur, { kind: "error", text: (e as Error).message }]);
    } finally {
      copy?.resolve(null);
      setApprovingId(null);
      setDebiting(false);
    }
  }

  const suggestions = [
    `Hire a friend for a logo · ${currency === "THB" ? "฿5,000" : "¥1,000"} · 2 milestones`,
    "What is my balance and limit?",
    "List my deals",
  ];
  const setConfirm = (d: DraftView | null) => {
    setConfirmState(d);
    setBalanceAtOpen(d && account ? Number(account.balance) / 100 : null);
  };
  const balanceAfter = confirm && balanceAtOpen !== null ? balanceAtOpen - Number(confirm.total) : null;

  return localizeMockupNode(
    <div className="aw-ai-chat-page">
      <BalanceBar />
      <div className={`aw-ai-chat-layout${agentOpen ? "" : " agent-panel-collapsed"}`}>
        <aside className="aw-v08-chats" aria-label="Saved chats">
          <header>
            <b>Chats</b>
            {chats && (
              <span>
                {chats.length}/{maxChats}
              </span>
            )}
          </header>
          <Button onClick={newChat} disabled={busy || full || (!chatId && items.length === 0)} title={full ? `${maxChats} chats max: delete one first` : "Start a new chat"}>
            ＋ New chat
          </Button>
          <div className="aw-v08-chat-list">
            {chats === null && address && <small>Loading chats…</small>}
            {!chatId && items.length > 0 && (
              <div className="selected">
                <button type="button" aria-pressed>
                  <b>New chat</b>
                  <small>Just now</small>
                </button>
              </div>
            )}
            {chats?.map((c) => (
              <div key={c.id} className={c.id === chatId ? "selected" : ""}>
                <button type="button" onClick={() => void openChat(c.id)} disabled={busy} aria-pressed={c.id === chatId} title={c.title}>
                  <b>{c.title}</b>
                  <small>{chatDate(c.updatedAt)}</small>
                </button>
                <button type="button" aria-label={`Delete chat ${c.title}`} onClick={() => void removeChat(c)} disabled={busy}>
                  <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <path d="M3 5h12M7 5V3h4v2M5 5l1 10h6l1-10M8 8v4M10 8v4" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <p>{full ? `${maxChats} chats max: delete one to start another. ` : ""}Deleting a chat removes only the conversation. Your deals and evidence stay.</p>
        </aside>
        <section className="aw-ai-conversation">
          <header className="aw-ai-chat-heading">
            <div>
              <h1>AI Chat</h1>
              <span className="aw-agent-online">
                <i />
                {status === "creating-wallet"
                  ? "Setting up your agent wallet (about 10 s)…"
                  : address
                    ? "Agent online"
                    : status === "error"
                      ? "Wallet setup failed"
                      : "Loading…"}
              </span>
              {status === "error" && !address && (
                <Button variant="outline" onClick={() => void refresh()}>
                  Retry setup
                </Button>
              )}
            </div>
            <span className="aw-policy-pill">Policy guard on</span>
          </header>
          <ActingSwitch />
          {aiOff && <p className="aw-bank-error">The AI chat is off (Profile &amp; Privacy → Preferences). Turn it on to draft deals with the agent.</p>}
          <div className="aw-ai-messages">
            <div className="aw-ai-message-meta">Agent</div>
            <article className="aw-ai-agent-message">
              <p>
                Hi {name}. Tell me what you want to hire. I will draft the deal and check your limits; nothing leaves your wallet until you approve.
              </p>
              <div className="aw-ai-suggestions">
                {suggestions.map((p) => (
                  <button type="button" key={p} onClick={() => setMessage(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </article>
            {status === "error" && setupError && <p className="aw-bank-error">{setupError}</p>}
            {loadingChat && <Loading text="Opening the chat…" />}
            {items.map((item, idx) =>
              item.kind === "user" ? (
                <div className="aw-ai-user-message" key={idx}>
                  <small>You · {item.at}</small>
                  {item.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="aw-ai-user-image" src={item.image} alt={item.file ?? "Attached image"} />
                  )}
                  {item.file && !item.image && <span className="aw-ai-user-file">📎 {item.file}</span>}
                  {item.text && <p>{item.text}</p>}
                </div>
              ) : item.kind === "error" ? (
                <article className="aw-ai-agent-message" key={idx}>
                  <p className="aw-bank-error">{item.text}</p>
                </article>
              ) : (
                <div key={idx}>
                  <div className="aw-ai-message-meta">Agent · {item.at}</div>
                  {item.live && (
                    <div className="aw-ai-live-steps">
                      {item.steps.map((s, i) => (
                        <span key={i} className="done" title={s.summary}>
                          ✓ {TOOL_LABEL[s.tool] ?? s.tool}
                        </span>
                      ))}
                      {(item.running ?? []).map((r) => (
                        <span key={r.id} className="running">
                          ◌ {TOOL_LABEL[r.tool] ?? r.tool}…
                        </span>
                      ))}
                      {!item.text && (item.running ?? []).length === 0 && <span className="running">◌ Thinking…</span>}
                    </div>
                  )}
                  {!item.live && item.steps.length > 0 && (
                    <div className="aw-ai-tool-badges">
                      {item.steps.map((s, i) => (
                        <span key={i} title={s.summary}>
                          {s.tool}
                        </span>
                      ))}
                    </div>
                  )}
                  <article className="aw-ai-agent-message aw-ai-draft-wrap">
                    <div className="aw-ai-markdown">
                      <ChatMarkdown text={item.text} />
                    </div>
                    {item.steps
                      .filter((s) => s.payout)
                      .map((s, k) => (
                        <PayoutCard key={`payout-${k}`} p={s.payout!} currency={currency} />
                      ))}
                    {item.steps
                      .filter((s) => s.open)
                      .map((s, k) => (
                        <OpenDealButton key={`open-${k}`} dealId={s.open!.dealId} title={s.open!.title} />
                      ))}
                    {item.steps
                      .filter((s) => s.form)
                      .map((s, k) => (
                        <div className="aw-ai-predraft-message" key={`form-${k}`}>
                          <DealFormCard form={s.form!} currency={currency} disabled={busy || item !== items[items.length - 1]} onSubmit={(text) => void send(text)} />
                        </div>
                      ))}
                    {item.steps
                      .filter((s) => s.draft)
                      .map((s) => (
                        <DraftCard
                          key={s.draft!.id}
                          draft={latest(s.draft!)}
                          currency={currency}
                          balance={account ? Number(account.balance) / 100 : null}
                          company={me?.acting ? { name: me.acting.name, threshold: me.acting.threshold } : null}
                          // A company's purchase debits nothing yet: it goes to the signers' vote.
                          onApprove={(d) => (d.side === "SELL" || me?.acting ? approve(d) : setConfirm(d))}
                          onDiscard={discard}
                          busy={approvingId === s.draft!.id}
                          onSaveTemplate={saveAsTemplate}
                        />
                      ))}
                  </article>
                </div>
              ),
            )}

            <div ref={endRef} />
          </div>
          <form
            className="aw-ai-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send(message);
            }}
          >
            {attached && (
              <div className="aw-ai-attached">
                {attached.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={attached.url} alt="" />
                ) : (
                  <span aria-hidden>📎</span>
                )}
                <b>{attached.att.name}</b>
                <button type="button" aria-label="Remove attachment" onClick={() => setAttached(null)}>
                  ×
                </button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={ATTACH_ACCEPT}
              hidden
              onChange={(e) => {
                void pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button type="button" className="aw-ai-attach" aria-label="Attach an image, PDF or text file" title="Attach an image, PDF or text file" disabled={!address || aiOff || busy} onClick={() => fileRef.current?.click()}>
              ＋
            </button>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onPaste={(event) => {
                const f = [...event.clipboardData.files].find((x) => x.type.startsWith("image/"));
                if (f) {
                  event.preventDefault();
                  void pickFile(f);
                }
              }}
              placeholder={attached ? "Say what to do with it (optional)…" : "Message AI agent… (＋ or paste to add an image or PDF)"}
              disabled={!address || aiOff}
            />
            <button type="submit" aria-label="Send message" disabled={!address || busy || (!message.trim() && !attached)}>
              ↑
            </button>
            <small>AI checks your balance and policy before any payment.</small>
          </form>
        </section>
        <aside className={`aw-v08-agent-rail${agentOpen ? " expanded" : ""}`}>
          <button className="aw-v08-agent-toggle" type="button" aria-label={agentOpen ? "Collapse agent details" : "Expand agent details"} aria-expanded={agentOpen} aria-controls="aw-agent-details" onClick={() => setAgentOpen((o) => !o)}>
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <rect x="2.5" y="2.5" width="13" height="13" rx="2" />
              <path d="M7 2.5v13M10 6h3M10 9h3M10 12h3" />
            </svg>
          </button>
          <span className="aw-v08-agent-symbol" role="img" aria-label="AI agent">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="7" width="14" height="13" rx="3" />
              <path d="M12 7V3H8M2 12v4M22 12v4M9 12v3M15 12v3" />
            </svg>
          </span>
          <button
            type="button"
            className={`aw-v08-limits-btn${limitsEditing ? " active" : ""}`}
            aria-label="Change the agent's limits per transaction and per day"
            title="Agent limits: per transaction / per day"
            onClick={() => {
              setAgentOpen(true);
              setLimitsEditing(true);
            }}
          >
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M3 5h12M3 13h12" />
              <circle cx="7" cy="5" r="1.8" />
              <circle cx="11" cy="13" r="1.8" />
            </svg>
          </button>
          {[0, 1, 2, 3].map((tier) => (
            <button key={tier} type="button" className={`aw-v08-tier tier${tier}`} aria-label={`Tier ${tier} details`} onClick={() => setAgentOpen(true)}>
              {tier}
            </button>
          ))}
          <div id="aw-agent-details" className="aw-v08-agent-details" aria-hidden={!agentOpen} inert={!agentOpen}>
            <h2>What the agent can do</h2>
            {TIER_TEXT.map((text, tier) => (
              <p key={text} className="aw-v08-agent-tier-row">
                <b className={`tier${tier}`}>Tier {tier}</b>
                <span>{text}</span>
              </p>
            ))}
            <hr />
            <LimitsEditor
              wallet={wallet}
              editing={limitsEditing}
              setEditing={setLimitsEditing}
              onSaved={refresh}
            />
            <hr />
            <small>Recent drafts</small>
            {drafts.length === 0 && <p className="aw-v08-agent-recent">None yet</p>}
            {drafts.slice(0, 4).map((d) => (
              <p className="aw-v08-agent-recent" key={d.id}>
                <i />
                {d.title} · {d.status.toLowerCase()}
              </p>
            ))}
          </div>
        </aside>
      </div>
      {templateFrom && (
        <SaveTemplateDialog
          payload={templateFrom}
          currency={currency}
          onClose={() => setTemplateFrom(null)}
          onSaved={(text) => setItems((cur) => [...cur, { kind: "agent", at: now(), steps: [], text }])}
        />
      )}
      {confirm &&
        typeof document !== "undefined" &&
        createPortal(
          localizeMockupNode(
            <div
              className="aw-debit-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setConfirm(null);
                  setDebitResult(null);
                }
              }}
            >
              <section className="aw-debit-dialog" role="dialog" aria-modal="true" aria-labelledby="aw-debit-title">
                <header>
                  <div>
                    <h2 id="aw-debit-title">{debitResult?.status === "FUNDED" ? "Locked in escrow" : "Confirm payment"}</h2>
                    <small>{confirm.title}</small>
                  </div>
                  <button
                    type="button"
                    aria-label="Close confirmation"
                    onClick={() => {
                      setConfirm(null);
                      setDebitResult(null);
                    }}
                  >
                    ×
                  </button>
                </header>
                <div className="aw-debit-amount">
                  <strong>{tokenMoney(confirm.total, currency)}</strong>
                  <small>{confirm.milestones.length} milestone(s), paid one by one after you approve each delivery</small>
                </div>
                <div className="aw-debit-details">
                  <p>
                    <span>From</span>
                    <b>
                      {account?.label} {account?.accountNo}
                    </b>
                  </p>
                  {balanceAfter !== null && balanceAfter < 0 && card && !debitResult && (
                    <p>
                      <span>Short by {tokenMoney(-balanceAfter, currency)}: charged first to</span>
                      <b>
                        {card.brand.toUpperCase()} ••{card.last4} (Stripe)
                      </b>
                    </p>
                  )}
                  <p>
                    <span>Balance after</span>
                    <b>{balanceAfter !== null ? tokenMoney(card && balanceAfter < 0 ? 0 : balanceAfter, currency) : "…"}</b>
                  </p>
                  {balanceAfter !== null && balanceAfter < 0 && !card && !debitResult && (
                    <p className="aw-bank-error">Not enough money in your wallet. Top up first, or link a card on the Profile page.</p>
                  )}
                </div>
                {debitResult ? (
                  <div className="aw-debit-checks">
                    <p>
                      {debitResult.status === "FUNDED" ? "✓" : "!"} <span>Result: {debitResult.status}</span>
                    </p>
                    {debitResult.error && <p className="aw-bank-error">{debitResult.error}</p>}
                    {debitResult.steps.map((s, i) => (
                      <p key={i}>
                        ✓{" "}
                        <span>
                          {s.step}
                          {s.outcome?.url && (
                            <>
                              {" · "}
                              <a href={s.outcome.url} target="_blank" rel="noreferrer">
                                tx ↗
                              </a>
                            </>
                          )}
                        </span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <div className="aw-debit-refund-note">
                    <i>ⓘ</i>
                    <span>If anything fails after the debit, the money is refunded to your wallet automatically.</span>
                  </div>
                )}
                <footer>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setConfirm(null);
                      setDebitResult(null);
                    }}
                  >
                    {debitResult || debiting ? "Close" : "Cancel"}
                  </Button>
                  {!debitResult && (
                    <Button disabled={debiting} onClick={() => approve(confirm)}>
                      {debiting ? "Debiting & locking…" : `Approve & debit ${tokenMoney(confirm.total, currency)}`}
                    </Button>
                  )}
                </footer>
              </section>
            </div>,
            lang,
          ),
          document.body,
        )}
    </div>,
    lang,
  );
}

// ------------------------------------------------------------------------------------------
// Deals (DealsScreen)
// ------------------------------------------------------------------------------------------

const STATUS_TONE: Record<string, string> = {
  Proposed: "blue",
  Active: "violet",
  Cancelled: "red",
  PREVIEW: "yellow",
  DRAFT: "yellow",
  FAILED: "red",
};

/** How the work arrives: a parcel (Physical), an encrypted file (Digital) or a written report. */
function deliveryType(d: DraftView): "Physical" | "Digital" | "Report" {
  const modes = d.milestones.map((m) => m.delivery ?? (m.hasFile ? "file" : "note"));
  return modes.includes("parcel") ? "Physical" : modes.includes("file") ? "Digital" : "Report";
}

export function LiveDeals({ go }: { go: (screen: string) => void }) {
  const lang = useLang();
  const { wallet, drafts, me, refresh } = useAppData();
  // A draft opens here (it used to be on the Approvals page): approve or discard it in place.
  const [openDraft, setOpenDraft] = useState<string | null>(null);
  const [draftMsg, setDraftMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const draftAddress = me?.acting ? (me.wallets.find((w) => w.label === me.acting?.name)?.address ?? me.wallets[0]?.address) : me?.wallets[0]?.address;
  async function draftAction(d: DraftView, kind: "approve" | "discard") {
    const address = d.wallet || draftAddress;
    if (!address || draftBusy) return;
    const copy = kind === "approve" && /link made on Confirm\)$/.test(d.sellerLabel) ? startDeferredCopy() : null;
    setDraftBusy(true);
    setDraftMsg(null);
    try {
      if (kind === "discard") {
        await api(`/api/workspace/${address}/drafts/${d.id}`, { method: "DELETE" });
        setOpenDraft(null);
        setDraftMsg({ ok: true, text: `Discarded “${d.title}”.` });
      } else {
        const r = await api<{
          funding?: FundingResult;
          companyVote?: { status: string; yes: number; threshold: number; company: string };
          invite?: { kind: "seller" | "buyer"; name: string; link: string | null } | null;
        }>(`/api/workspace/${address}/drafts/${d.id}/approve`, { method: "POST" });
        const v = r.companyVote;
        const link = r.invite?.link ?? null;
        copy?.resolve(link);
        const copied = link ? (copy ? await copy.done : await copyText(link)) : false;
        const linkNote = link ? ` ${copied ? "The private link was copied to your clipboard" : "The private link is on the deal's page"} for ${r.invite!.name}.` : "";
        setDraftMsg(
          v
            ? { ok: true, text: v.status === "EXECUTED" ? `${v.company}'s signers approved it.` : `Submitted to ${v.company}'s signers: ${v.yes} of ${v.threshold} so far (they vote on the group's page).` }
            : r.funding?.status === "FUNDED"
              ? { ok: true, text: (d.side === "SELL" ? `Offer sent: deal #${r.funding.dealId}.` : `Locked: deal #${r.funding.dealId}.`) + linkNote }
              : { ok: false, text: r.funding?.error ?? `Not done (${r.funding?.status ?? "unknown"})` },
        );
      }
      await refresh();
    } catch (e) {
      setDraftMsg({ ok: false, text: (e as Error).message });
    } finally {
      copy?.resolve(null);
      setDraftBusy(false);
    }
  }
  const [filter, setFilter] = useState<"All" | "Buying" | "Selling" | "Dispute" | "Templates">("All");
  const [templateFrom, setTemplateFrom] = useState<TemplatePayload | null>(null);
  const [templateCount, setTemplateCount] = useState<number | null>(null);
  useEffect(() => {
    api<{ templates: unknown[] }>("/api/templates")
      .then((r) => setTemplateCount(r.templates.length))
      .catch(() => setTemplateCount(null));
  }, []);
  // Deals someone hired the user for through a seller link, linked to this account.
  const [linkedInvites, setLinkedInvites] = useState<{ id: string; buyer: string; href: string }[]>([]);
  useEffect(() => {
    api<{ invites: { id: string; buyer: string; href: string }[] }>("/api/invites/claimed")
      .then((r) => setLinkedInvites(r.invites))
      .catch(() => setLinkedInvites([]));
  }, []);
  const currency = me?.bank.currency ?? "THB";
  const explorer = wallet?.explorer?.replace(/\/address\/.*/, "") ?? null;

  const rows = [
    ...drafts
      // The AI's previews too: they are confirmed (or discarded) here, not only in the chat.
      .filter((d) => d.status === "PREVIEW" || d.status === "DRAFT" || d.status === "FAILED")
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .map((d) => ({
        key: `draft-${d.id}`,
        draftId: d.id,
        id: d.status === "PREVIEW" ? "Preview" : "Draft",
        title: d.title,
        kind: d.kind,
        type: deliveryType(d),
        person: d.sellerLabel || d.counterparty,
        role: d.side === "SELL" ? ("Selling" as const) : ("Buying" as const),
        milestones: `0 / ${d.milestones.length}`,
        amount: tokenMoney(d.total, currency),
        status:
          d.status === "PREVIEW"
            ? "AI preview · confirm to create"
            : d.status === "DRAFT"
              ? "Awaiting your approval"
              : d.side === "SELL"
                ? "Failed · not offered"
                : "Failed · refunded",
        tone: STATUS_TONE[d.status],
      })),
    // Newest first: a higher deal number is a newer deal.
    ...[...(wallet?.fileDeals ?? [])].sort((a, b) => b.id - a.id).map((d) => {
      const done = d.milestones.filter((m) => m.status === "Released" || m.status === "Split").length;
      const disputed = d.milestones.some((m) => m.status === "Disputed");
      const draft = drafts.find((x) => x.dealId === d.id);
      return {
        key: `deal-${d.id}`,
        draftId: null as string | null,
        id: `D-${d.id}`,
        title: draft?.title ?? `File deal #${d.id}`,
        kind: draft?.kind ?? null,
        type: draft ? deliveryType(draft) : d.milestones.some((m) => m.hasFile) ? ("Digital" as const) : null,
        person: d.counterpartyLabel || d.counterparty,
        role: d.role === "buyer" ? ("Buying" as const) : ("Selling" as const),
        milestones: `${done} / ${d.milestones.length}`,
        amount: tokenMoney(d.total, currency),
        status: d.status === "Cancelled"
          ? "Cancelled · withdrawn"
          : disputed
          ? "Dispute"
          : done === d.milestones.length
            ? "Completed · paid"
            : d.status === "Proposed"
              ? d.offeredBy === "them"
                ? "Offer to you · open to accept"
                : d.role === "buyer" ? "Waiting for seller" : "Waiting for buyer"
              : "In progress",
        tone: d.status === "Cancelled" ? "gray" : disputed ? "red" : done === d.milestones.length ? "green" : STATUS_TONE[d.status] ?? "blue",
      };
    }),
  ];
  const visible = rows.filter((r) => filter === "All" || (filter === "Dispute" ? r.status === "Dispute" : r.role === filter));
  const counts = {
    All: rows.length,
    Buying: rows.filter((r) => r.role === "Buying").length,
    Selling: rows.filter((r) => r.role === "Selling").length,
    Dispute: rows.filter((r) => r.status === "Dispute").length,
  };

  return localizeMockupNode(
    <div className="aw-deals-page">
      <BalanceBar />
      <div className="aw-deals-content">
        <header className="aw-deals-heading">
          <div>
            <h1>Deals</h1>
            <p>Everything you are buying and selling, milestone by milestone</p>
          </div>
          <Button onClick={() => go("สร้างดีล")}>New deal with AI</Button>
        </header>
        {linkedInvites.length > 0 && (
          <div className="aw-linked-invites">
            <b>Hired through a link</b>
            {linkedInvites.map((i) => (
              <a key={i.id} href={`${i.href}${i.href.includes("?") ? "&" : "?"}stay=1`}>
                {i.buyer} hired you · open →
              </a>
            ))}
          </div>
        )}
        <div className="aw-deals-tabs" role="tablist" aria-label="Filter deals">
          {(["All", "Buying", "Selling", "Dispute", "Templates"] as const).map((item) => (
            <button type="button" role="tab" key={item} aria-selected={filter === item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
              {item} <span>{item === "Templates" ? (templateCount ?? "…") : counts[item]}</span>
            </button>
          ))}
        </div>
        {filter === "Templates" && <TemplatesPanel currency={currency} onCount={setTemplateCount} />}
        <div className="aw-deals-table-wrap" hidden={filter === "Templates"}>
          <table className="aw-deals-table">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Type</th>
                <th>Role</th>
                <th>Milestones</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!wallet && (
                <tr>
                  <td colSpan={6}>
                    <Loading text="Reading your deals from the chain…" />
                  </td>
                </tr>
              )}
              {wallet && visible.length === 0 && (
                <tr>
                  <td colSpan={6}>No deals yet. Ask the AI agent in the chat to draft one.</td>
                </tr>
              )}
              {visible.map((r) => (
                <tr
                  key={r.key}
                  tabIndex={0}
                  className={r.draftId && openDraft === r.draftId ? "selected" : undefined}
                  onClick={() => (r.draftId ? setOpenDraft(openDraft === r.draftId ? null : r.draftId) : go(`รายละเอียดดีล ${r.id}`))}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    if (r.draftId) setOpenDraft(openDraft === r.draftId ? null : r.draftId);
                    else go(`รายละเอียดดีล ${r.id}`);
                  }}
                >
                  <td>
                    <span className="aw-deal-id">{r.id}</span>
                    <span className="aw-deal-name">
                      <b>
                        {r.title}
                        {r.kind && <span className={`aw-kind-badge ${r.kind === "GOODS" ? "goods" : "hire"}`}>{r.kind === "GOODS" ? "BUY" : "HIRE"}</span>}
                      </b>
                      <small>{r.person}</small>
                    </span>
                  </td>
                  <td>
                    {r.type && <span className={`aw-v08-deal-type ${r.type === "Physical" ? "physical" : "digital"}`}>{r.type === "Physical" ? "▣ Physical" : r.type === "Report" ? "▤ Report" : "▤ Digital"}</span>}
                  </td>
                  <td>
                    <span className={`aw-deal-role ${r.role === "Selling" ? "selling" : "buying"}`}>{r.role}</span>
                  </td>
                  <td className="aw-deal-milestones">{r.milestones}</td>
                  <td className="aw-deal-amount">
                    <b>{r.amount}</b>
                  </td>
                  <td>
                    <span className={`aw-deal-status ${r.tone}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {draftMsg && <p className={draftMsg.ok ? "aw-live-ok" : "aw-bank-error"}>{draftMsg.text}</p>}
        {templateFrom && <SaveTemplateDialog payload={templateFrom} currency={currency} onClose={() => setTemplateFrom(null)} onSaved={(text) => setDraftMsg({ ok: true, text })} />}
        {(() => {
          const d = drafts.find((x) => x.id === openDraft && (x.status === "PREVIEW" || x.status === "DRAFT" || x.status === "FAILED"));
          if (!d) return null;
          return (
            <div className="aw-deals-draft">
              <DraftCard
                draft={d}
                currency={currency}
                balance={me?.accounts[0] ? Number(me.accounts[0].balance) / 100 : null}
                company={me?.acting ? { name: me.acting.name, threshold: me.acting.threshold } : null}
                onApprove={(x) => void draftAction(x, "approve")}
                onDiscard={(x) => void draftAction(x, "discard")}
                busy={draftBusy}
                onSaveTemplate={(x) => setTemplateFrom(templateFromDraft(x))}
              />
              {draftBusy && <Loading text="Working on it…" />}
            </div>
          );
        })()}
        {explorer && wallet && (
          <p className="aw-profile-passbook-note">
            Every lock is an on-chain transaction:{" "}
            <a href={wallet.explorer ?? "#"} target="_blank" rel="noreferrer">
              view your agent wallet ↗
            </a>
          </p>
        )}
      </div>
    </div>,
    lang,
  );
}

// ------------------------------------------------------------------------------------------
// Profile & privacy (PrivacyScreen)
// ------------------------------------------------------------------------------------------

type KycStatus = {
  currency: "THB" | "CNY";
  provider: "THAID" | "CN_NETID";
  verified: { provider: string; maskedId: string; name: string; at: string } | null;
  limits: { dealUnverified: number; topupUnverified: number; topupVerified: number };
};

/** Identity verification (KYC) through a national digital ID: mock ThaID or mock 国家网络身份认证. */
function KycCard() {
  const [kyc, setKyc] = useState<KycStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    // The ID provider sends the user back here with ?kyc=ok or an error message.
    const r = new URLSearchParams(window.location.search).get("kyc");
    if (r) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult(r);
      window.history.replaceState(null, "", window.location.pathname);
    }
    api<KycStatus>("/api/kyc").then(setKyc).catch(() => setKyc(null));
  }, []);
  async function start() {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/api/kyc/start", { method: "POST" });
      window.location.assign(url);
    } catch (e) {
      setResult((e as Error).message);
      setBusy(false);
    }
  }
  const thai = kyc?.provider === "THAID";
  const c = kyc?.currency ?? "THB";
  return (
    <Card className="aw-kyc-card">
      <header>
        <h2>Identity verification (KYC)</h2>
        {kyc?.verified ? <span className="aw-kyc-ok">✓ Verified</span> : kyc ? <span className="aw-kyc-no">Not verified</span> : null}
      </header>
      {!kyc && <Loading text="Checking your verification…" />}
      {result === "ok" && <p className="aw-live-ok">✓ Your identity is verified. Higher limits are on.</p>}
      {result && result !== "ok" && <p className="aw-bank-error">{result}</p>}
      {kyc?.verified && (
        <p>
          {kyc.verified.provider === "THAID" ? "ThaID" : "国家网络身份认证 (National Network Identity)"} · {kyc.verified.maskedId} · {kyc.verified.name}
          <small> · {new Date(kyc.verified.at).toLocaleDateString()}</small>
        </p>
      )}
      {kyc && !kyc.verified && (
        <>
          <p>
            Until you verify, deals are limited to {tokenMoney(kyc.limits.dealUnverified, c)} and card top-ups to {tokenMoney(kyc.limits.topupUnverified, c)}. Verify with{" "}
            {thai ? "ThaID, Thailand's digital ID" : "国家网络身份认证 (China's National Network Identity: the app gets a 网号, never your ID number)"}.
          </p>
          <Button disabled={busy} onClick={() => void start()}>
            {busy ? "Opening…" : thai ? "Verify with ThaID" : "Verify with 国家网络身份认证"}
          </Button>
          <small className="aw-kyc-note">Demo identity provider: use test data. We keep only a masked id and a hash, never the ID number.</small>
        </>
      )}
      {kyc?.verified && (
        <small className="aw-kyc-note">
          Limits now: deals up to your agent policy · top-ups up to {tokenMoney(kyc.limits.topupVerified, c)}
        </small>
      )}
    </Card>
  );
}

type StripeLinkView = { enabled: boolean; link: { brand: string; last4: string; exp: string; since: string } | null };

/** A card linked through Stripe, used like a second bank: it covers a short balance at approval. */
function StripeLinkCard() {
  const [view, setView] = useState<StripeLinkView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => api<StripeLinkView>("/api/bank/stripe-link").then(setView).catch(() => setView(null));
  useEffect(() => {
    const session = new URLSearchParams(window.location.search).get("stripe_link");
    if (session) {
      window.history.replaceState(null, "", window.location.pathname);
      if (session === "cancelled") {
        // Reading the redirect's result once on mount is what this effect is for.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMsg({ ok: false, text: "Linking cancelled" });
      } else {
        void api<{ brand: string; last4: string }>("/api/bank/stripe-link/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session }),
        })
          .then((c) => setMsg({ ok: true, text: `✓ ${c.brand} ••${c.last4} linked` }))
          .catch((e) => setMsg({ ok: false, text: (e as Error).message }))
          .finally(() => void load());
        return;
      }
    }
    void load();
  }, []);
  async function link() {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/api/bank/stripe-link", { method: "POST" });
      window.location.assign(url);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm("Unlink this card? Deals will then be paid from your wallet balance only.")) return;
    setBusy(true);
    try {
      await api("/api/bank/stripe-link", { method: "DELETE" });
      setMsg({ ok: true, text: "Card unlinked" });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="aw-kyc-card">
      <header>
        <h2>Linked card · Stripe</h2>
        {view?.link ? <span className="aw-kyc-ok">✓ Linked</span> : view ? <span className="aw-kyc-no">Not linked</span> : null}
      </header>
      {!view && <Loading text="Checking your linked card…" />}
      {msg && <p className={msg.ok ? "aw-live-ok" : "aw-bank-error"}>{msg.text}</p>}
      {view?.link ? (
        <>
          <p>
            <b>
              {view.link.brand.toUpperCase()} ••{view.link.last4}
            </b>{" "}
            · expires {view.link.exp} · test mode. When your wallet balance is short at &quot;Approve &amp; lock&quot;, the missing amount is charged here
            and paid into your account first.
          </p>
          <Button variant="outline" disabled={busy} onClick={() => void remove()}>
            Unlink card
          </Button>
        </>
      ) : (
        view && (
          <>
            <p>Link a card once: deals you approve are then never stopped by a short balance. Stripe test mode, test card 4242 4242 4242 4242.</p>
            <Button disabled={busy || !view.enabled} onClick={() => void link()}>
              {busy ? "Opening Stripe…" : "Link a card with Stripe"}
            </Button>
          </>
        )
      )}
      <small className="aw-kyc-note">Stripe in Thailand cannot debit a bank account directly, and PromptPay needs you each time; a card is the reusable source.</small>
    </Card>
  );
}

export function LivePrivacy() {
  const lang = useLang();
  const { me } = useAppData();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = me?.bank.currency ?? "THB";

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/me", { method: "DELETE" });
      await authClient.signOut();
      window.location.href = "/";
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function signOut() {
    await authClient.signOut();
    window.location.href = "/";
  }

  return localizeMockupNode(
    <div className="aw-profile-page">
      <BalanceBar />
      <main className="aw-profile-content">
        <PageTitle title="Profile & Privacy" description="Your wallet, identity and what happens to your data (PDPA)" />
        <div className="aw-profile-top">
          <Card className="aw-profile-person">
            <div className="aw-profile-identity">
              <span>{me?.user.name.slice(0, 1).toUpperCase() ?? "?"}</span>
              <div>
                <b>{me?.user.name ?? "…"}</b>
                <small>{me?.bank.name}</small>
              </div>
            </div>
            <div className="aw-profile-setting">
              <span>Account type</span>
              <div className="aw-profile-tags">
                <b>{me?.bank.customerType === "COMPANY" ? "Company" : "Personal"}</b>
              </div>
            </div>
            <div className="aw-profile-setting">
              <span>Session</span>
              <Button variant="outline" onClick={signOut}>
                Sign out
              </Button>
            </div>
          </Card>
          <KycCard />
          <SecurityCard />
          <DisplaySizeCard />
          <StripeLinkCard />
          <Card className="aw-profile-passbooks">
            <header>
              <div>
                <h2>Wallet account</h2>
                <small>
                  {me?.bank.name} · {currency}
                </small>
              </div>
            </header>
            {me?.accounts.map((a) => (
              <article className="aw-profile-passbook" key={a.id}>
                <i>
                  <WalletIcon />
                </i>
                <div>
                  <b>
                    {a.label} {a.accountNo} {a.isDefault && <span>Default</span>}
                  </b>
                  <small>{a.currency}</small>
                </div>
                <strong>{money(a.balance, a.currency)}</strong>
              </article>
            ))}
            <p className="aw-profile-passbook-note">E-money (test money) held by Agentic Wallet. Top up with the button above; deals lock money from here and pay out back here.</p>
          </Card>
        </div>
        <PreferencesCard currency={currency} />
        <CompaniesPanel />
        <section className="aw-profile-bottom">
          <Card className="aw-profile-consent">
            <h2>Your data</h2>
            <p>On-chain we store only hashes of the deal terms. Names, titles and chat stay in our database, which you can export or delete.</p>
            <div>
              <Button variant="outline" onClick={() => download("/api/me/export")}>
                Download my data (JSON)
              </Button>
            </div>
          </Card>
          <Card className="aw-profile-delete">
            <h2>Delete my account</h2>
            <p>Your profile and drafts are deleted and your passbooks are unlinked. On-chain hashes stay, but they cannot be traced back to you.</p>
            {deleteConfirm && <div className="aw-profile-confirm">This deletes your profile and unlinks all passbooks. It cannot be undone.</div>}
            {error && <p className="aw-bank-error">{error}</p>}
            <div>
              {deleteConfirm ? (
                <>
                  <Button variant="outline" onClick={() => setDeleteConfirm(false)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={remove} disabled={busy}>
                    {busy ? "Deleting…" : "Yes, delete everything"}
                  </Button>
                </>
              ) : (
                <Button variant="danger" onClick={() => setDeleteConfirm(true)}>
                  Delete account
                </Button>
              )}
            </div>
          </Card>
        </section>
      </main>
    </div>,
    lang,
  );
}
