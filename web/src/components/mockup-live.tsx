"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DraftView } from "@/lib/bank/drafts";
import { authClient } from "@/lib/auth-client";
import { localizeMockupNode, useLang } from "@/lib/i18n";

import { type AccountView, api, download, lockedInDeals, money, tokenMoney, useAppData } from "./app-data";
import { Button, Card, Loading, PageTitle } from "./mockup-ui";
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
  const { me, wallet, status } = useAppData();
  const account = defaultAccount(me?.accounts);
  const currency = me?.bank.currency ?? "THB";
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
            {currency} wallet · {account?.accountNo ?? "…"}
          </small>
          <b>
            {account ? money(account.balance, currency) : "…"} <i>Available</i>
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
        <TopUp currency={currency} />
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

type Step = { tool: string; summary: string; draft?: DraftView };
type ChatItem =
  | { kind: "user"; text: string; at: string }
  /** `live`: still streaming; `running`: tool calls started but not finished yet. */
  | { kind: "agent"; text: string; at: string; steps: Step[]; live?: boolean; running?: { id: string; tool: string }[] }
  | { kind: "error"; text: string };

/** What the agent is doing, in words, while a tool runs. */
const TOOL_LABEL: Record<string, string> = {
  get_wallet_status: "Checking your wallet, limits and payees",
  list_deals: "Reading your deals",
  propose_bank_deal: "Drafting the deal",
  propose_bank_sale: "Drafting the sale offer",
  invite_seller: "Creating a wallet and invite link",
  remember_nickname: "Remembering the nickname",
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

type FundingResult = { status: string; steps: { step: string; outcome?: { url?: string | null; hash?: string } }[]; error?: string };

function DraftCard({
  draft,
  currency,
  onApprove,
  onDiscard,
}: {
  draft: DraftView;
  currency: "THB" | "CNY";
  onApprove: (d: DraftView) => void;
  onDiscard: (d: DraftView) => void;
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
  const sell = draft.side === "SELL";
  const who = draft.sellerLabel || `${draft.counterparty.slice(0, 6)}…${draft.counterparty.slice(-4)}`;
  return (
    <section className="aw-deal-draft">
      <div className="aw-draft-topline">
        <small>
          {sell ? "DRAFT OFFER TO SELL" : "DRAFT DEAL"} · DR-{draft.id.slice(-6).toUpperCase()}
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
        {!sell && <i className="green">In allowlist ✓</i>}
      </div>
      {draft.milestones.map((m, i) => (
        <div className="aw-draft-milestone" key={i}>
          <i>{i + 1}</i>
          <span>
            <b>
              {m.name}
              {(m.delivery ?? (m.hasFile ? "file" : "note")) === "parcel" ? " · 📦 parcel" : m.hasFile ? " · 📎 file" : ""}
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
      <div className="aw-draft-notice">
        ⓘ &nbsp;
        {sell
          ? "Sending puts the offer on-chain and locks nothing. The buyer pays the total from their wallet when they accept; you are paid as each delivery is approved."
          : "Approving takes the total from your wallet balance and locks it in escrow. Each milestone is paid only after you approve its delivery."}
      </div>
      {!funded && (
        <div className="aw-draft-actions">
          <Button variant="outline" onClick={() => onDiscard(draft)}>
            Discard
          </Button>
          <Button onClick={() => onApprove(draft)}>{failed ? "Try again" : sell ? `Send offer · ${tokenMoney(draft.total, currency)}` : `Approve & lock ${tokenMoney(draft.total, currency)}`}</Button>
        </div>
      )}
    </section>
  );
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
    if (!address || busy || !window.confirm(`Delete the chat "${c.title}"? Drafts made in it stay in Approvals.`)) return;
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

  async function send(text: string) {
    if (!text.trim() || !address || busy) return;
    if (!chatId && full) {
      setItems((cur) => [...cur, { kind: "error", text: `You have ${maxChats} chats. Delete one to start a new chat.` }]);
      return;
    }
    setItems((cur) => [...cur, { kind: "user", text: text.trim(), at: now() }, { kind: "agent", text: "", at: now(), steps: [], live: true, running: [] }]);
    setMessage("");
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
        body: JSON.stringify({ message: text.trim(), lang, chatId: chatId ?? "new" }),
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
    setDebiting(true);
    setDebitResult(null);
    try {
      const res = await api<{ draft: DraftView; funding: FundingResult }>(`/api/workspace/${address}/drafts/${d.id}/approve`, { method: "POST" });
      setDebitResult(res.funding);
      if (d.side === "SELL" && res.funding.status !== "FUNDED") {
        setItems((cur) => [...cur, { kind: "error", text: `The offer was not sent: ${res.funding.error ?? res.funding.status}` }]);
      }
      await refresh();
    } catch (e) {
      setDebitResult({ status: "ERROR", steps: [], error: (e as Error).message });
      if (d.side === "SELL") setItems((cur) => [...cur, { kind: "error", text: (e as Error).message }]);
    } finally {
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
      <div className="aw-ai-chat-layout">
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
          <nav className="aw-chat-tabs" aria-label="Saved chats">
            <button type="button" className="aw-chat-new" onClick={newChat} disabled={busy || full || (!chatId && items.length === 0)} title={full ? `${maxChats} chats max: delete one first` : "Start a new chat"}>
              ＋ New chat
            </button>
            {chats === null && address && <span className="aw-chat-count">Loading chats…</span>}
            {chats?.map((c) => (
              <span key={c.id} className={`aw-chat-tab${c.id === chatId ? " active" : ""}`}>
                <button type="button" onClick={() => void openChat(c.id)} disabled={busy} title={c.title}>
                  {c.title}
                </button>
                <button type="button" aria-label={`Delete chat ${c.title}`} onClick={() => void removeChat(c)} disabled={busy}>
                  ×
                </button>
              </span>
            ))}
            {chats && (
              <span className="aw-chat-count">
                {chats.length}/{maxChats}
                {full && " · delete one to start another"}
              </span>
            )}
          </nav>
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
                  <p>{item.text}</p>
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
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
                    </div>
                    {item.steps
                      .filter((s) => s.draft)
                      .map((s) => (
                        <DraftCard key={s.draft!.id} draft={latest(s.draft!)} currency={currency} onApprove={(d) => (d.side === "SELL" ? approve(d) : setConfirm(d))} onDiscard={discard} />
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
            <button type="button" aria-label="Attach file" disabled>
              ＋
            </button>
            <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Message AI agent…" disabled={!address} />
            <button type="submit" aria-label="Send message" disabled={!address || busy}>
              ↑
            </button>
            <small>AI checks your balance and policy before any payment.</small>
          </form>
        </section>
        <aside className="aw-ai-agent-panel">
          <h2>What the agent can do</h2>
          <div className="aw-agent-tier">
            <i className="tier0">Tier 0</i>
            <span>Read balance, deals, history</span>
          </div>
          <div className="aw-agent-tier">
            <i className="tier1">Tier 1</i>
            <span>Draft a deal · you approve the debit</span>
          </div>
          <div className="aw-agent-tier">
            <i className="tier2">Tier 2</i>
            <span>Approve small deliveries within limits + allowlist</span>
          </div>
          <div className="aw-agent-tier">
            <i className="tier3">Tier 3</i>
            <span>Pause · anyone can, only owner resumes</span>
          </div>
          <hr />
          <small>Your limits</small>
          <p className="aw-ai-limit">
            <span>Per transaction</span>
            <b>{wallet ? tokenMoney(wallet.session.maxPerTx, wallet.token.currency) : "…"}</b>
          </p>
          <p className="aw-ai-limit">
            <span>Per day</span>
            <b>{wallet ? tokenMoney(wallet.session.dailyLimit, wallet.token.currency) : "…"}</b>
          </p>
          <hr />
          <small>Recent drafts</small>
          {drafts.slice(0, 4).map((d) => (
            <p className="aw-ai-recent" key={d.id}>
              <i />
              {d.title} · {d.status.toLowerCase()}
            </p>
          ))}
        </aside>
      </div>
      {confirm &&
        typeof document !== "undefined" &&
        createPortal(
          localizeMockupNode(
            <div
              className="aw-debit-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !debiting) {
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
                    disabled={debiting}
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
                    disabled={debiting}
                    onClick={() => {
                      setConfirm(null);
                      setDebitResult(null);
                    }}
                  >
                    {debitResult ? "Close" : "Cancel"}
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
  DRAFT: "yellow",
  FAILED: "red",
};

export function LiveDeals({ go }: { go: (screen: string) => void }) {
  const lang = useLang();
  const { wallet, drafts, me } = useAppData();
  const [filter, setFilter] = useState<"All" | "Buying" | "Selling">("All");
  const currency = me?.bank.currency ?? "THB";
  const explorer = wallet?.explorer?.replace(/\/address\/.*/, "") ?? null;

  const rows = [
    ...drafts
      .filter((d) => d.status === "DRAFT" || d.status === "FAILED")
      .map((d) => ({
        key: `draft-${d.id}`,
        id: "Draft",
        title: d.title,
        kind: d.kind,
        person: d.sellerLabel || d.counterparty,
        role: d.side === "SELL" ? ("Selling" as const) : ("Buying" as const),
        milestones: `0 / ${d.milestones.length}`,
        amount: tokenMoney(d.total, currency),
        status: d.status === "DRAFT" ? "Awaiting your approval" : d.side === "SELL" ? "Failed · not offered" : "Failed · refunded",
        tone: STATUS_TONE[d.status],
      })),
    ...(wallet?.fileDeals ?? []).map((d) => {
      const done = d.milestones.filter((m) => m.status === "Released").length;
      const disputed = d.milestones.some((m) => m.status === "Disputed");
      const draft = drafts.find((x) => x.dealId === d.id);
      return {
        key: `deal-${d.id}`,
        id: `D-${d.id}`,
        title: draft?.title ?? `File deal #${d.id}`,
        kind: draft?.kind ?? null,
        person: d.counterpartyLabel || d.counterparty,
        role: d.role === "buyer" ? ("Buying" as const) : ("Selling" as const),
        milestones: `${done} / ${d.milestones.length}`,
        amount: tokenMoney(d.total, currency),
        status: disputed ? "Dispute" : done === d.milestones.length ? "Completed · paid" : d.status === "Proposed" ? "Waiting for seller" : "In progress",
        tone: disputed ? "red" : done === d.milestones.length ? "green" : STATUS_TONE[d.status] ?? "blue",
      };
    }),
  ];
  const visible = rows.filter((r) => filter === "All" || r.role === filter);
  const counts = { All: rows.length, Buying: rows.filter((r) => r.role === "Buying").length, Selling: rows.filter((r) => r.role === "Selling").length };

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
        <div className="aw-deals-tabs" role="tablist" aria-label="Filter deals">
          {(["All", "Buying", "Selling"] as const).map((item) => (
            <button type="button" role="tab" key={item} aria-selected={filter === item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
              {item} <span>{counts[item]}</span>
            </button>
          ))}
        </div>
        <div className="aw-deals-table-wrap">
          <table className="aw-deals-table">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Role</th>
                <th>Milestones</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!wallet && (
                <tr>
                  <td colSpan={5}>
                    <Loading text="Reading your deals from the chain…" />
                  </td>
                </tr>
              )}
              {wallet && visible.length === 0 && (
                <tr>
                  <td colSpan={5}>No deals yet. Ask the AI agent in the chat to draft one.</td>
                </tr>
              )}
              {visible.map((r) => (
                <tr
                  key={r.key}
                  tabIndex={r.id.startsWith("D-") ? 0 : -1}
                  onClick={() => r.id.startsWith("D-") && go(`รายละเอียดดีล ${r.id}`)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && r.id.startsWith("D-")) go(`รายละเอียดดีล ${r.id}`);
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
