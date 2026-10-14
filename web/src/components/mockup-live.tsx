"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DraftView } from "@/lib/bank/drafts";
import { authClient } from "@/lib/auth-client";
import { localizeMockupNode, useLang } from "@/lib/i18n";

import { type AccountView, api, lockedInDeals, money, tokenMoney, useAppData } from "./app-data";
import { Button, Card, PageTitle } from "./mockup-ui";
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

export function BalanceBar() {
  const { me, wallet } = useAppData();
  const account = defaultAccount(me?.accounts);
  const currency = me?.bank.currency ?? "THB";
  const bank = currency === "THB" ? "Thai bank" : "Chinese bank";
  return (
    <div className="aw-ai-balancebar">
      <div className="aw-ai-bank">
        <span className="aw-ai-wallet-icon">
          <WalletIcon />
        </span>
        <span>
          <small>
            {bank} · passbook {account?.accountNo ?? "…"}
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
        <span className="aw-no-topup">× No top-up / withdraw</span>
        <span className="aw-demo-bank-pill">Demo bank</span>
      </div>
    </div>
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
  | { kind: "agent"; text: string; at: string; steps: Step[] }
  | { kind: "error"; text: string };

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

type FundingResult = { status: string; steps: { step: string; outcome?: { url?: string | null; hash?: string } }[]; error?: string };

function DraftCard({ draft, currency, onApprove }: { draft: DraftView; currency: "THB" | "CNY"; onApprove: (d: DraftView) => void }) {
  const funded = draft.status === "FUNDED";
  const failed = draft.status === "FAILED";
  return (
    <section className="aw-deal-draft">
      <div className="aw-draft-topline">
        <small>DRAFT DEAL · {draft.id.slice(-6).toUpperCase()}</small>
        <span>{funded ? `Locked · deal #${draft.dealId}` : failed ? "Failed · money refunded" : "Needs your approval · Tier 1"}</span>
      </div>
      <h2>{draft.title}</h2>
      <div className="aw-draft-parties">
        <span>
          Seller&nbsp; <b>{draft.sellerLabel || `${draft.seller.slice(0, 6)}…${draft.seller.slice(-4)}`}</b>
        </span>
        <i className="green">In allowlist ✓</i>
      </div>
      {draft.milestones.map((m, i) => (
        <div className="aw-draft-milestone" key={i}>
          <i>{i + 1}</i>
          <span>
            <b>{m.name}</b>
            <small>{m.due ? `Due ${m.due}` : m.acceptance}</small>
          </span>
          <strong>{tokenMoney(m.amount, currency)}</strong>
        </div>
      ))}
      <div className="aw-draft-total">
        <span>Total</span>
        <b>{tokenMoney(draft.total, currency)}</b>
      </div>
      <div className="aw-draft-notice">
        ⓘ &nbsp;Approving debits the total from your bank and locks it in escrow. Each milestone is paid only after you approve its delivery.
      </div>
      {!funded && (
        <div className="aw-draft-actions">
          <Button onClick={() => onApprove(draft)}>{failed ? "Try again" : `Approve & lock ${tokenMoney(draft.total, currency)}`}</Button>
        </div>
      )}
    </section>
  );
}

export function LiveChat() {
  const lang = useLang();
  const { me, wallet, drafts, refresh, status } = useAppData();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
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

  async function send(text: string) {
    if (!text.trim() || !address || busy) return;
    const history = items
      .filter((i): i is Extract<ChatItem, { kind: "user" | "agent" }> => i.kind !== "error")
      .map((i) => ({ role: i.kind === "user" ? ("user" as const) : ("assistant" as const), text: i.text }))
      .slice(-20);
    setItems((cur) => [...cur, { kind: "user", text: text.trim(), at: now() }]);
    setMessage("");
    setBusy(true);
    try {
      const res = await api<{ reply: string; steps: Step[] }>(`/api/workspace/${address}/agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ history, message: text.trim(), lang }),
      });
      setItems((cur) => [...cur, { kind: "agent", text: res.reply, at: now(), steps: res.steps }]);
      if (res.steps.some((s) => s.draft)) void refresh();
    } catch (e) {
      setItems((cur) => [...cur, { kind: "error", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  async function approve(d: DraftView) {
    if (!address) return;
    setDebiting(true);
    setDebitResult(null);
    try {
      const res = await api<{ draft: DraftView; funding: FundingResult }>(`/api/workspace/${address}/drafts/${d.id}/approve`, { method: "POST" });
      setDebitResult(res.funding);
      await refresh();
    } catch (e) {
      setDebitResult({ status: "ERROR", steps: [], error: (e as Error).message });
    } finally {
      setDebiting(false);
    }
  }

  const suggestions = [
    `Hire the demo contractor for a logo · ${currency === "THB" ? "฿5,000" : "¥1,000"} · 2 milestones`,
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
                {status === "creating-wallet" ? "Setting up your agent wallet…" : address ? "Agent online" : "Loading…"}
              </span>
            </div>
            <span className="aw-policy-pill">Policy guard on</span>
          </header>
          <div className="aw-ai-messages">
            <div className="aw-ai-message-meta">Agent</div>
            <article className="aw-ai-agent-message">
              <p>
                Hi {name}. Tell me what you want to hire. I will draft the deal and check your limits; nothing leaves your bank until you approve.
              </p>
              <div className="aw-ai-suggestions">
                {suggestions.map((p) => (
                  <button type="button" key={p} onClick={() => setMessage(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </article>
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
                  {item.steps.length > 0 && (
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
                        <DraftCard key={s.draft!.id} draft={latest(s.draft!)} currency={currency} onApprove={setConfirm} />
                      ))}
                  </article>
                </div>
              ),
            )}
            {busy && <div className="aw-ai-message-meta">Agent is thinking…</div>}
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
            <small>AI checks bank balance and policy before any debit.</small>
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
                    <h2 id="aw-debit-title">{debitResult?.status === "FUNDED" ? "Locked in escrow" : "Confirm bank debit"}</h2>
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
                  <p>
                    <span>Balance after</span>
                    <b>{balanceAfter !== null ? tokenMoney(balanceAfter, currency) : "…"}</b>
                  </p>
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
                    <span>If anything fails after the debit, the money is refunded to your bank automatically.</span>
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
        person: d.sellerLabel || d.seller,
        role: "Buying" as const,
        milestones: `0 / ${d.milestones.length}`,
        amount: tokenMoney(d.total, currency),
        status: d.status === "DRAFT" ? "Awaiting your approval" : "Failed · refunded",
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
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5}>No deals yet. Ask the AI agent in the chat to draft one.</td>
                </tr>
              )}
              {visible.map((r) => (
                <tr key={r.key}>
                  <td>
                    <span className="aw-deal-id">{r.id}</span>
                    <span className="aw-deal-name">
                      <b>{r.title}</b>
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
        <PageTitle title="Profile & Privacy" description="Your passbooks and what happens to your data (PDPA)" />
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
          <Card className="aw-profile-passbooks">
            <header>
              <div>
                <h2>Linked passbooks</h2>
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
            <p className="aw-profile-passbook-note">To link other passbooks, log in to the bank again and tick them on the consent screen.</p>
          </Card>
        </div>
        <section className="aw-profile-bottom">
          <Card className="aw-profile-consent">
            <h2>Your data</h2>
            <p>On-chain we store only hashes of the deal terms. Names, titles and chat stay in our database, which you can export or delete.</p>
            <div>
              <Button variant="outline" onClick={() => (window.location.href = "/api/me/export")}>
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
