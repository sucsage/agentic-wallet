"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { localizeMockupNode, useLang } from "@/lib/i18n";

import { api, download, tokenMoney, useAppData } from "./app-data";
import { BalanceBar } from "./mockup-live";
import { Button, Card, PageTitle } from "./mockup-ui";

/**
 * Second batch of mockup screens wired to the backend: approvals, policy, friends, groups,
 * summary and deal detail. Same Figma classes; every number and button is real.
 */

type Outcome = { status: string; url?: string | null; error?: string };

/** GETs `path` on mount and on `reload()`; `every` polls in ms (for screens that move on their own). */
function useApi<T>(path: string | null, every?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    // Loading the screen's data is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    if (!every) return;
    const t = setInterval(() => void reload(), every);
    return () => clearInterval(t);
  }, [reload, every]);
  return { data, error, reload };
}

function send<T>(path: string, method: string, body?: unknown) {
  return api<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Runs an action, shows "…" while it runs, reports the outcome or error inline. */
function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string; url?: string | null } | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, done?: () => unknown) => {
    setBusy(key);
    setMessage(null);
    try {
      const r = (await fn()) as { outcome?: Outcome; status?: string; error?: string } | undefined;
      const o = r?.outcome;
      if (o && o.status !== "success") setMessage({ ok: false, text: o.error ?? o.status, url: o.url });
      // Accepting a seller's offer reports a funding status instead of one transaction.
      else if (r?.status && !["FUNDED", "success"].includes(r.status))
        setMessage({ ok: false, text: r.status === "REFUNDED" ? `Not accepted · money refunded to your bank${r.error ? ` (${r.error})` : ""}` : `Still processing (${r.status}) · try again in a moment` });
      else setMessage({ ok: true, text: "Done", url: o?.url });
      await done?.();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const note: ReactNode = message ? (
    <p className={message.ok ? "aw-live-ok" : "aw-bank-error"}>
      {message.ok ? "✓ " : "! "}
      {message.text}
      {message.url && (
        <>
          {" · "}
          <a href={message.url} target="_blank" rel="noreferrer">
            tx ↗
          </a>
        </>
      )}
    </p>
  ) : null;
  return { busy, run, note };
}

const when = (unix: number) =>
  unix ? new Date(unix * 1000).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

// ------------------------------------------------------------------------------------------
// Approvals
// ------------------------------------------------------------------------------------------

type Approvals = {
  count: number;
  sellerTodo: { dealId: number; title: string; index: number | null; amount: string; step: "accept" | "deliver" }[];
  offers: { dealId: number; title: string; amount: string; seller: string; sellerLabel: string }[];
  drafts: { id: string; side: "BUY" | "SELL"; title: string; total: string; sellerLabel: string; counterparty: string; milestones: unknown[] }[];
  reviews: { dealId: number; title: string; index: number; amount: string; reviewUntil: number; tier: 1 | 2 }[];
  groupVotes: { proposalId: string; group: { id: string; name: string; threshold: number }; title: string; yes: number }[];
  proposals: { id: number; summary: string }[];
};

export function LiveApprovals() {
  const lang = useLang();
  const { me, refresh } = useAppData();
  const { data, error, reload } = useApi<Approvals>("/api/approvals");
  const { busy, run, note } = useAction();
  const currency = me?.bank.currency ?? "THB";
  const address = me?.wallets[0]?.address;
  const after = async () => {
    await reload();
    await refresh();
  };

  return localizeMockupNode(
    <div className="aw-approvals-page">
      <BalanceBar />
      <main className="aw-approvals-content">
        <header className="aw-approvals-heading">
          <h1>
            Approvals <span>{data?.count ?? "…"}</span>
          </h1>
          <p>The agent proposes, you decide. Nothing is debited until you approve.</p>
        </header>
        {error && <p className="aw-bank-error">{error}</p>}
        {note}
        <small className="aw-approvals-section-label">YOUR ACCOUNT</small>
        <div className="aw-approval-list">
          {data && data.offers.length + data.drafts.length + data.reviews.length === 0 && <p className="aw-approval-empty">Nothing waiting for you.</p>}
          {data?.drafts.map((d) => (
            <article className="aw-approval-item" key={d.id}>
              <span className="aw-approval-tier">T1</span>
              <div className="aw-approval-copy">
                <b>
                  {d.side === "SELL" ? "Offer to sell" : "Lock"} “{d.title}” · {tokenMoney(d.total, currency)}
                </b>
                <p>
                  {d.side === "SELL"
                    ? `To ${d.sellerLabel || d.counterparty}. Sending locks nothing; they pay when they accept.`
                    : `To ${d.sellerLabel || d.counterparty}. Locking money always needs your approval.`}
                </p>
                {d.side !== "SELL" && <small>Debited from your default passbook only when you press approve</small>}
              </div>
              <div className="aw-approval-buttons">
                <Button
                  disabled={!!busy || !address}
                  onClick={() => run(d.id, () => send(`/api/workspace/${address}/drafts/${d.id}/approve`, "POST"), after)}
                >
                  {busy === d.id ? (d.side === "SELL" ? "Sending…" : "Locking…") : d.side === "SELL" ? "Send offer" : "Approve & debit"}
                </Button>
              </div>
            </article>
          ))}
          {data?.offers.map((o) => (
            <article className="aw-approval-item" key={`o${o.dealId}`}>
              <span className="aw-approval-tier">T1</span>
              <div className="aw-approval-copy">
                <b>
                  Offer from {o.sellerLabel || o.seller} · {o.title} · {tokenMoney(o.amount, currency)}
                </b>
                <p>Accepting debits the total from your bank and locks it in escrow until you approve each delivery.</p>
                <small>The seller must be one of your payees</small>
              </div>
              <div className="aw-approval-buttons">
                <Button variant="outline" onClick={() => (window.location.href = `/deal/D-${o.dealId}`)}>
                  Details
                </Button>
                <Button
                  disabled={!!busy}
                  onClick={() => run(`o${o.dealId}`, () => send(`/api/deals/${o.dealId}/action`, "POST", { action: "accept" }), after)}
                >
                  {busy === `o${o.dealId}` ? "Paying…" : `Accept & pay ${tokenMoney(o.amount, currency)}`}
                </Button>
              </div>
            </article>
          ))}
          {data?.reviews.map((r) => (
            <article className="aw-approval-item" key={`${r.dealId}-${r.index}`}>
              <span className="aw-approval-tier">T{r.tier}</span>
              <div className="aw-approval-copy">
                <b>
                  Review delivery · {r.title} · milestone {r.index + 1} · {tokenMoney(r.amount, currency)}
                </b>
                <p>
                  {r.tier === 2 ? "Within the agent's limits: approving runs on the agent's own authority." : "Above the agent's limits: your signature is needed."}
                </p>
                <small>Review window ends {when(r.reviewUntil)}</small>
              </div>
              <div className="aw-approval-buttons">
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => (window.location.href = `/deal/D-${r.dealId}`)}
                >
                  Dispute
                </Button>
                <Button
                  disabled={!!busy}
                  onClick={() => run(`a${r.dealId}-${r.index}`, () => send(`/api/deals/${r.dealId}/action`, "POST", { action: "approve", index: r.index }), after)}
                >
                  {busy === `a${r.dealId}-${r.index}` ? "…" : "Approve work"}
                </Button>
              </div>
            </article>
          ))}
        </div>
        <small className="aw-approvals-section-label">SELLING</small>
        <div className="aw-approval-list">
          {data?.sellerTodo.length === 0 && <p className="aw-approval-empty">Nothing to deliver.</p>}
          {data?.sellerTodo.map((t) => (
            <article className="aw-approval-item" key={`s${t.dealId}-${t.index}`}>
              <span className="aw-approval-tier">{t.step === "accept" ? "Offer" : `M${(t.index ?? 0) + 1}`}</span>
              <div className="aw-approval-copy">
                <b>
                  {t.step === "accept" ? "Accept offer" : "Deliver"} · {t.title} · {tokenMoney(t.amount, currency)}
                </b>
                <p>{t.step === "accept" ? "The buyer already locked the money in escrow." : "Upload the work and your evidence on the deal page."}</p>
              </div>
              <div className="aw-approval-buttons">
                <Button onClick={() => (window.location.href = `/deal/D-${t.dealId}`)}>Open deal</Button>
              </div>
            </article>
          ))}
        </div>
        <small className="aw-approvals-section-label group">GROUP VOTES</small>
        <div className="aw-approval-list">
          {data?.groupVotes.length === 0 && <p className="aw-approval-empty">No group votes waiting.</p>}
          {data?.groupVotes.map((v) => (
            <article className="aw-approval-item group" key={v.proposalId}>
              <span className="aw-approval-tier group">
                {v.yes}/{v.group.threshold}
              </span>
              <div className="aw-approval-copy">
                <b>
                  {v.group.name} · {v.title}
                </b>
                <p>
                  {v.yes} of {v.group.threshold} required votes so far. The vote that reaches it locks the deal from the proposer’s bank.
                </p>
              </div>
              <div className="aw-approval-buttons">
                <Button variant="outline" disabled={!!busy} onClick={() => run(`n${v.proposalId}`, () => send(`/api/groups/proposals/${v.proposalId}/vote`, "POST", { approve: false }), after)}>
                  Decline
                </Button>
                <Button disabled={!!busy} onClick={() => run(`y${v.proposalId}`, () => send(`/api/groups/proposals/${v.proposalId}/vote`, "POST", { approve: true }), after)}>
                  {busy === `y${v.proposalId}` ? "…" : "Approve"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>,
    lang,
  );
}

// ------------------------------------------------------------------------------------------
// Policy & allowlist
// ------------------------------------------------------------------------------------------

type Policy = {
  wallet: string;
  explorer: string | null;
  token: { symbol: string; currency: "THB" | "CNY" | null };
  paused: boolean;
  session: { maxPerTx: string; dailyLimit: string; remainingToday: string; active: boolean; expiresAt: number };
  recipients: { address: string; label: string; friendshipId: string | null; allowed: boolean }[];
};

type AuditEntry = { block: string; event: string; detail: string; txHash: string; url: string | null };

export function LivePolicy() {
  const lang = useLang();
  const { me } = useAppData();
  const { data, error, reload } = useApi<Policy>("/api/policy");
  const address = me?.wallets[0]?.address;
  const { data: state, reload: reloadState } = useApi<{ audit: AuditEntry[] }>(address ? `/api/workspace/${address}` : null);
  const { busy, run, note } = useAction();
  const [editing, setEditing] = useState(false);
  const [perTx, setPerTx] = useState("");
  const [perDay, setPerDay] = useState("");
  const currency = data?.token.currency ?? me?.bank.currency ?? "THB";

  return localizeMockupNode(
    <div className="aw-policy-page">
      <BalanceBar />
      <main className="aw-policy-content">
        <PageTitle title="Policy & Allowlist" description="The policy engine and the smart contract enforce the same rules" />
        {error && <p className="aw-bank-error">{error}</p>}
        {note}
        <section className="aw-policy-tiers">
          {[
            ["Tier 0", "Read", "Balance, deals, history", "green"],
            ["Tier 1", "Propose", "Lock money, add payees · you approve", "amber"],
            ["Tier 2", "Act alone", "Within limits and allowlist only", "blue"],
            ["Tier 3", "Pause", "Anyone can pause · only you resume", "red"],
          ].map(([tier, title, description, tone]) => (
            <article className={`aw-policy-tier ${tone}`} key={tier}>
              <span>{tier}</span>
              <b>{title}</b>
              <small>{description}</small>
            </article>
          ))}
        </section>
        <section className="aw-policy-grid">
          <Card className="aw-policy-limits">
            <header>
              <h2>Agent limits</h2>
              <Button
                variant="outline"
                onClick={() => {
                  setPerTx(data?.session.maxPerTx ?? "");
                  setPerDay(data?.session.dailyLimit ?? "");
                  setEditing((v) => !v);
                }}
              >
                {editing ? "Cancel" : "Edit"}
              </Button>
            </header>
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("limits", () => send("/api/policy/limits", "PUT", { maxPerTx: Number(perTx), dailyLimit: Number(perDay) }), async () => {
                    setEditing(false);
                    await reload();
                  });
                }}
              >
                <label className="aw-policy-limit">
                  <span>Per transaction</span>
                  <input aria-label="Per transaction limit" type="number" min="1" step="any" value={perTx} onChange={(e) => setPerTx(e.target.value)} />
                </label>
                <label className="aw-policy-limit">
                  <span>Per day</span>
                  <input aria-label="Per day limit" type="number" min="1" step="any" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
                </label>
                <Button type="submit" disabled={busy === "limits"}>
                  {busy === "limits" ? "Saving on-chain…" : "Save"}
                </Button>
              </form>
            ) : (
              <>
                <div className="aw-policy-limit">
                  <span>Per transaction</span>
                  <b>{data ? tokenMoney(data.session.maxPerTx, currency) : "…"}</b>
                </div>
                <div className="aw-policy-limit">
                  <span>Per day</span>
                  <b>{data ? tokenMoney(data.session.dailyLimit, currency) : "…"}</b>
                </div>
                <div className="aw-policy-limit">
                  <span>Left today</span>
                  <b>{data ? tokenMoney(data.session.remainingToday, currency) : "…"}</b>
                </div>
              </>
            )}
            <div className="aw-policy-limit">
              <span>Wallet</span>
              <b className={data?.paused ? "aw-red" : "aw-green"}>{data ? (data.paused ? "Paused" : "Active") : "…"}</b>
            </div>
            <Button
              variant={data?.paused ? "primary" : "danger"}
              disabled={!data || busy === "pause"}
              onClick={() => run("pause", () => send("/api/policy/pause", "POST", { paused: !data!.paused }), reload)}
            >
              {busy === "pause" ? "…" : data?.paused ? "Resume agent" : "Ⅱ Emergency pause"}
            </Button>
            <div className="aw-policy-callout">→ &nbsp;Over a limit → becomes a Tier 1 action that waits for you.</div>
          </Card>
          <Card className="aw-policy-allowlist">
            <header>
              <h2>Allowlist · who can be paid</h2>
            </header>
            <div className="aw-policy-recipient-list">
              {data?.recipients.map((r) => (
                <div className="aw-policy-recipient" key={r.address}>
                  <div>
                    <b>{r.label}</b>
                    <small>
                      {r.address.slice(0, 8)}…{r.address.slice(-4)}
                      {r.friendshipId ? " · friend" : ""}
                    </small>
                  </div>
                  {r.allowed ? (
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => run(r.address, () => send("/api/policy/recipients", "DELETE", { address: r.address }), reload)}
                    >
                      {busy === r.address ? "…" : "Remove"}
                    </Button>
                  ) : (
                    <span className="pending">Not allowed</span>
                  )}
                </div>
              ))}
            </div>
            <p className="aw-friend-policy">ⓘ Add payees from Friends. Nobody can be added by pasting an address.</p>
          </Card>
          <Card className="aw-policy-test">
            <header>
              <h2>Test the defenses</h2>
              <Button
                disabled={!address || busy === "attack"}
                onClick={() => run("attack", () => send(`/api/workspace/${address}/action`, "POST", { type: "raw_attack" }), reloadState)}
              >
                {busy === "attack" ? "Attacking…" : "Run attack"}
              </Button>
            </header>
            <p>Uses the agent key directly, skipping the policy engine, to send 5,000 to an attacker. The contract must refuse it on-chain.</p>
            <div className="aw-policy-test-hint">A revert here (RecipientNotAllowed or a cap) is the defense working.</div>
          </Card>
          <Card className="aw-policy-audit">
            <h2>Audit log</h2>
            {[...(state?.audit ?? [])].reverse().slice(0, 8).map((a, i) => (
              <div className="aw-policy-audit-row" key={i}>
                <time>#{a.block}</time>
                <span className={/Revoked|Paused|Cancelled/.test(a.event) ? "red" : "amber"}>{a.event}</span>
                <p>
                  {a.detail}
                  {a.url && (
                    <>
                      {" "}
                      <a href={a.url} target="_blank" rel="noreferrer">
                        ↗
                      </a>
                    </>
                  )}
                </p>
              </div>
            ))}
            {data?.explorer && (
              <small>
                Every action is a transaction:{" "}
                <a href={data.explorer} target="_blank" rel="noreferrer">
                  view the wallet ↗
                </a>
              </small>
            )}
          </Card>
        </section>
      </main>
    </div>,
    lang,
  );
}

// ------------------------------------------------------------------------------------------
// Friends
// ------------------------------------------------------------------------------------------

type Friend = {
  friendshipId: string;
  userId: string;
  name: string;
  username: string;
  status: "PENDING" | "ACCEPTED";
  direction: "incoming" | "outgoing" | "mutual";
  wallet: string | null;
  allowlisted: boolean;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function LiveFriends() {
  const lang = useLang();
  const { data, error, reload } = useApi<{ friends: Friend[] }>("/api/friends");
  const { busy, run, note } = useAction();
  const [username, setUsername] = useState("");
  const friends = data?.friends ?? [];
  const incoming = friends.filter((f) => f.direction === "incoming");
  const outgoing = friends.filter((f) => f.direction === "outgoing");
  const mutual = friends.filter((f) => f.status === "ACCEPTED");

  return localizeMockupNode(
    <div className="aw-friends-page">
      <BalanceBar />
      <main className="aw-friends-content">
        <header className="aw-friends-heading">
          <div>
            <h1>Friends</h1>
            <p>Add friends from your bank to invite them to groups and make them payees</p>
          </div>
        </header>
        {error && <p className="aw-bank-error">{error}</p>}
        {note}
        <div className="aw-friends-top">
          <section className="aw-friends-panel aw-find-friends">
            <h2>Add a friend</h2>
            <p>Use their Mock Bank username. Only customers of your bank are found.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("add", () => send("/api/friends", "POST", { username }), async () => {
                  setUsername("");
                  await reload();
                });
              }}
            >
              <label className="aw-friends-search">
                <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="bank username" />
              </label>
              <Button type="submit" disabled={!username || busy === "add"}>
                {busy === "add" ? "…" : "Send request"}
              </Button>
            </form>
            <div className="aw-friend-search-results">
              {outgoing.map((f) => (
                <div className="aw-friend-result" key={f.friendshipId}>
                  <span className="aw-friend-avatar blue">{initials(f.name)}</span>
                  <span className="aw-friend-name">
                    <b>{f.name}</b>
                    <small>@{f.username}</small>
                  </span>
                  <Button variant="outline" disabled>
                    Request sent
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>
        <InviteByLink />
        <section className="aw-friends-panel aw-friend-requests">
          <header>
            <h2>Friend requests</h2>
            <span>{incoming.length}</span>
          </header>
          {incoming.length === 0 && <small>No requests.</small>}
          {incoming.map((f) => (
            <div className="aw-request-row" key={f.friendshipId}>
              <span className="aw-friend-avatar red">{initials(f.name)}</span>
              <span className="aw-friend-name">
                <b>{f.name}</b>
                <small>@{f.username}</small>
              </span>
              <div>
                <Button variant="outline" disabled={!!busy} onClick={() => run(`x${f.friendshipId}`, () => send(`/api/friends/${f.friendshipId}`, "DELETE"), reload)}>
                  Decline
                </Button>
                <Button disabled={!!busy} onClick={() => run(`a${f.friendshipId}`, () => send(`/api/friends/${f.friendshipId}`, "POST"), reload)}>
                  Accept
                </Button>
              </div>
            </div>
          ))}
        </section>
        <section className="aw-friends-panel aw-my-friends">
          <header>
            <h2>My friends · {mutual.length}</h2>
          </header>
          <div className="aw-friend-policy">ⓘ &nbsp; A friend is not automatically in your allowlist. Making someone a payee is an on-chain action you approve.</div>
          <div className="aw-friend-cards">
            {mutual.map((f) => (
              <article key={f.friendshipId}>
                <div className="aw-friend-card-head">
                  <span className="aw-friend-avatar violet">{initials(f.name)}</span>
                  <span>
                    <b>{f.name}</b>
                    <small>@{f.username}</small>
                  </span>
                </div>
                <div className="aw-friend-tags">{f.allowlisted && <span className="allow">allowlist</span>}</div>
                <div className="aw-friend-card-actions">
                  <Button
                    variant="outline"
                    disabled={!!busy || !f.wallet}
                    onClick={() => run(`p${f.friendshipId}`, () => send(`/api/friends/${f.friendshipId}/payee`, "PUT", { allowed: !f.allowlisted }), reload)}
                  >
                    {busy === `p${f.friendshipId}` ? "…" : f.allowlisted ? "Allowlisted ✓ · remove" : f.wallet ? "Add to allowlist" : "No wallet yet"}
                  </Button>
                  <Button variant="outline" disabled={!!busy} onClick={() => run(`u${f.friendshipId}`, () => send(`/api/friends/${f.friendshipId}`, "DELETE"), reload)}>
                    Unfriend
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>,
    lang,
  );
}

type InviteRow = { id: string; name: string; wallet: string; payoutSet: boolean; expiresAt: string };

/**
 * Hire someone without an account: their wallet is made and allowlisted at once, and they get a
 * link (also as a QR code) to accept, deliver and choose a PromptPay id or bank account for payment.
 */
function InviteByLink() {
  const { data, reload } = useApi<{ invites: InviteRow[] }>("/api/invites");
  const { busy, run, note } = useAction();
  const [name, setName] = useState("");
  const [shown, setShown] = useState<{ name: string; link: string; qr: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const show = async (who: string, link: string) => {
    setCopied(false);
    setShown({ name: who, link, qr: await QRCode.toDataURL(link, { margin: 1, width: 220 }) });
  };

  return (
    <section className="aw-friends-panel aw-invite-panel">
      <h2>Hire someone without an account</h2>
      <p>They get a link: no sign-up, they accept, deliver and are paid to PromptPay or any bank account. Creating the link makes them a payee.</p>
      {note}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            "invite",
            async () => {
              const r = await send<{ link: string; invite: { name: string } }>("/api/invites", "POST", { name });
              await show(r.invite.name, r.link);
              return r;
            },
            async () => {
              setName("");
              await reload();
            },
          );
        }}
      >
        <label className="aw-friends-search">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seller's name, e.g. Somchai Jaidee" maxLength={80} />
        </label>
        <Button type="submit" disabled={name.trim().length < 2 || !!busy}>
          {busy === "invite" ? "Creating wallet…" : "Create link"}
        </Button>
      </form>
      {shown && (
        <div className="aw-invite-link">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown.qr} alt={`QR code of the link for ${shown.name}`} width={140} height={140} />
          <div>
            <b>Link for {shown.name}</b>
            <code>{shown.link}</code>
            <small>Send it privately (LINE, email). Anyone with it acts as the seller; it is shown only now.</small>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(shown.link).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied ✓" : "Copy link"}
            </Button>
          </div>
        </div>
      )}
      {(data?.invites.length ?? 0) > 0 && (
        <div className="aw-invite-list">
          {data!.invites.map((i) => (
            <div key={i.id} className="aw-friend-result">
              <span className="aw-friend-avatar blue">{initials(i.name)}</span>
              <span className="aw-friend-name">
                <b>{i.name}</b>
                <small>{i.payoutSet ? "payout account set" : "no payout account yet"} · allowlisted</small>
              </span>
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() =>
                  run(`l${i.id}`, async () => {
                    const r = await send<{ link: string }>(`/api/invites/${i.id}/link`, "POST");
                    await show(i.name, r.link);
                    return r;
                  })
                }
              >
                {busy === `l${i.id}` ? "…" : "New link"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------
// Groups
// ------------------------------------------------------------------------------------------

type GroupSummary = { id: string; name: string; currency: string; threshold: number; members: { userId: string; name: string; role: string }[]; openProposals: number };
type GroupDetail = GroupSummary & {
  proposals: { id: string; proposerId: string; title: string; status: string; dealId: number | null; yes: number; no: number; myVote: boolean | null; milestones: { amount: string }[] }[];
};

export function LiveGroups({ initialCreateOpen = false }: { initialCreateOpen?: boolean }) {
  const lang = useLang();
  const { me, drafts, refresh } = useAppData();
  const { data, error, reload } = useApi<{ groups: GroupSummary[] }>("/api/groups");
  const { data: friendsData } = useApi<{ friends: Friend[] }>("/api/friends");
  const [selected, setSelected] = useState<string | null>(null);
  const { data: detail, reload: reloadDetail } = useApi<GroupDetail>(selected ? `/api/groups/${selected}` : null, selected ? 8000 : undefined);
  const { busy, run, note } = useAction();
  const [creating, setCreating] = useState(initialCreateOpen);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(2);
  const [draftId, setDraftId] = useState("");
  const currency = me?.bank.currency ?? "THB";
  const friends = (friendsData?.friends ?? []).filter((f) => f.status === "ACCEPTED");
  const openDrafts = drafts.filter((d) => d.status === "DRAFT");
  const total = (ms: { amount: string }[]) => ms.reduce((t, m) => t + Number(m.amount), 0);

  return localizeMockupNode(
    <div className="aw-groups-page">
      <BalanceBar />
      <main className="aw-groups-content">
        <header className="aw-groups-heading">
          <div>
            <h1>Groups</h1>
            <p>Decide together: a group deal is locked only after enough members approve. No shared pot, no idle money.</p>
          </div>
          <Button onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "＋ Create group"}</Button>
        </header>
        {error && <p className="aw-bank-error">{error}</p>}
        {note}
        {creating && (
          <Card className="aw-group-panel">
            <h2>New group</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("create", () => send("/api/groups", "POST", { name, memberIds: members, threshold }), async () => {
                  setCreating(false);
                  setName("");
                  setMembers([]);
                  await reload();
                });
              }}
            >
              <label className="aw-create-field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
              </label>
              <small>Members (friends only)</small>
              <div className="aw-invite-friend-list">
                {friends.length === 0 && <small>Add friends first.</small>}
                {friends.map((f) => (
                  <label key={f.userId} className="aw-bank-consent">
                    <input
                      type="checkbox"
                      checked={members.includes(f.userId)}
                      onChange={(e) => setMembers((cur) => (e.target.checked ? [...cur, f.userId] : cur.filter((x) => x !== f.userId)))}
                    />
                    <span>{f.name}</span>
                  </label>
                ))}
              </div>
              <label className="aw-create-field">
                <span>
                  Votes needed (of {members.length + 1} members, you included)
                </span>
                <input type="number" min={1} max={members.length + 1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
              </label>
              <Button type="submit" disabled={busy === "create" || !name}>
                {busy === "create" ? "…" : "Create group"}
              </Button>
            </form>
          </Card>
        )}
        <div className="aw-group-cards">
          {data?.groups.length === 0 && <p>No groups yet.</p>}
          {data?.groups.map((g) => (
            <article className="aw-group-card" key={g.id} onClick={() => setSelected(g.id)} role="button" tabIndex={0}>
              <div className="aw-group-card-top">
                <b>{g.name}</b>
                <small>
                  {g.threshold} of {g.members.length} votes · {g.currency}
                </small>
              </div>
              <div className="aw-group-members">{g.members.map((m) => m.name).join(", ")}</div>
              <small>{g.openProposals} open vote(s)</small>
            </article>
          ))}
        </div>
        {selected && detail && (
          <section className="aw-group-wallet-detail">
            <header className="aw-group-wallet-heading">
              <h2>{detail.name}</h2>
              <small>
                {detail.threshold} of {detail.members.length} members must approve a group deal
              </small>
            </header>
            <Card className="aw-group-wallet-card aw-group-wallet-votes">
              <h3>Put a draft to the vote</h3>
              <p>Ask the AI in the chat to draft the deal first. It is paid from your bank once the vote passes.</p>
              <select value={draftId} onChange={(e) => setDraftId(e.target.value)}>
                <option value="">Choose one of your drafts…</option>
                {openDrafts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} · {tokenMoney(d.total, currency)}
                  </option>
                ))}
              </select>
              <Button
                disabled={!draftId || busy === "propose"}
                onClick={() => run("propose", () => send(`/api/groups/${detail.id}/proposals`, "POST", { draftId }), async () => {
                  setDraftId("");
                  await reloadDetail();
                  await refresh();
                })}
              >
                {busy === "propose" ? "…" : "Propose to group"}
              </Button>
            </Card>
            {detail.proposals.map((p) => (
              <article className="aw-gw-proposal" key={p.id}>
                <div>
                  <b>{p.title}</b>
                  <small className="aw-gw-proposal-meta">
                    {tokenMoney(total(p.milestones), currency)} · {p.yes} yes / {p.no} no · {p.status.toLowerCase()}
                    {p.dealId !== null ? ` · deal D-${p.dealId}` : ""}
                  </small>
                </div>
                {p.status === "OPEN" && p.myVote === null && (
                  <div className="aw-gw-actions">
                    <Button variant="outline" disabled={!!busy} onClick={() => run(`n${p.id}`, () => send(`/api/groups/proposals/${p.id}/vote`, "POST", { approve: false }), reloadDetail)}>
                      No
                    </Button>
                    <Button disabled={!!busy} onClick={() => run(`y${p.id}`, () => send(`/api/groups/proposals/${p.id}/vote`, "POST", { approve: true }), async () => {
                      await reloadDetail();
                      await refresh();
                    })}>
                      {busy === `y${p.id}` ? "…" : "Yes"}
                    </Button>
                  </div>
                )}
                {p.myVote !== null && p.status === "OPEN" && <small>You voted {p.myVote ? "yes" : "no"}</small>}
              </article>
            ))}
          </section>
        )}
      </main>
    </div>,
    lang,
  );
}

// ------------------------------------------------------------------------------------------
// Summary (CFO)
// ------------------------------------------------------------------------------------------

type Summary = {
  currency: "THB" | "CNY";
  totals: { income: number; spent: number; refunds: number; net: number; openingDeposits: number };
  months: { month: string; income: number; spent: number; refunds: number }[];
  deals: { title: string; spent: number; refunded: number }[];
  tax: { kind: string; year: number; income: number; taxable: number; tax: number; vatWarning: string | null; notes: string[] } | null;
};

export function LiveSummary() {
  const lang = useLang();
  const { wallet } = useAppData();
  const { data, error } = useApi<Summary>("/api/summary");
  const [ai, setAi] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const c = data?.currency ?? "THB";
  const locked = wallet
    ? wallet.fileDeals
        .filter((d) => d.role === "buyer" && d.status !== "Cancelled")
        .flatMap((d) => d.milestones)
        .filter((m) => !["Released", "Refunded"].includes(m.status))
        .reduce((t, m) => t + Number(m.amount), 0)
    : 0;
  const max = Math.max(1, ...(data?.months ?? []).flatMap((m) => [m.income, m.spent]));

  async function explain() {
    setAiBusy(true);
    setAiError(null);
    try {
      const r = await send<{ summary: string }>("/api/summary/ai", "POST", { lang });
      setAi(r.summary);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  return localizeMockupNode(
    <div className="aw-summary-page">
      <BalanceBar />
      <main className="aw-summary-content">
        <header className="aw-summary-heading">
          <div>
            <h1>Summary</h1>
            <p>Money in and out of your bank accounts this year, explained by AI</p>
          </div>
          <div className="aw-summary-controls">
            <Button onClick={() => download("/api/summary/export")}>⇩ Export CSV</Button>
          </div>
        </header>
        {error && <p className="aw-bank-error">{error}</p>}
        <div className="aw-summary-metrics">
          {(
            [
              ["Received", data?.totals.income, "Paid to you as a seller", "green"],
              ["Spent", data?.totals.spent, "Locked into deals from your bank", "red"],
              ["Locked now", locked, "Still in escrow", "yellow"],
              ["Refunded", data?.totals.refunds, "Came back to your bank", "blue"],
            ] as const
          ).map(([label, amount, detail, tone]) => (
            <article className="aw-summary-metric" key={label}>
              <div>
                <small>{label}</small>
              </div>
              <b className={tone}>{amount === undefined ? "…" : tokenMoney(amount, c)}</b>
              <p>{detail}</p>
            </article>
          ))}
        </div>
        <section className="aw-summary-ai">
          <div className="aw-summary-ai-head">
            <b>AI summary</b>
            <small>Reads totals only</small>
          </div>
          {ai ? (
            <div className="aw-ai-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{ai}</ReactMarkdown>
            </div>
          ) : (
            <p>Ask the AI to explain your spending, income and tax estimate. It never sees names or account numbers.</p>
          )}
          {aiError && <p className="aw-bank-error">{aiError}</p>}
          <div>
            <Button onClick={explain} disabled={aiBusy}>
              {aiBusy ? "Thinking…" : ai ? "Refresh" : "Explain with AI"}
            </Button>
          </div>
        </section>
        <section className="aw-summary-chart">
          <header>
            <b>Received vs spent · by month</b>
            <span>
              <i className="green-dot" /> Received <i className="red-dot" /> Spent
            </span>
          </header>
          <div className="aw-summary-bars">
            {(data?.months ?? []).map((m) => (
              <div className="aw-summary-bar-group" key={m.month}>
                <div className="aw-summary-bars-pair">
                  <i style={{ height: `${Math.round((m.income / max) * 100)}px` }} />
                  <i style={{ height: `${Math.round((m.spent / max) * 100)}px` }} />
                </div>
                <small>{m.month}</small>
              </div>
            ))}
          </div>
        </section>
        {data?.tax && (
          <section className="aw-summary-activity">
            <header>
              <b>
                Tax estimate {data.tax.year} · {data.tax.kind === "company" ? "SME corporate income tax" : "personal income tax"}
              </b>
            </header>
            <div className="aw-summary-table-wrap">
              <table>
                <tbody>
                  <tr>
                    <td>Income through the app</td>
                    <td>{tokenMoney(data.tax.income, c)}</td>
                  </tr>
                  <tr>
                    <td>Taxable</td>
                    <td>{tokenMoney(data.tax.taxable, c)}</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Estimated tax</b>
                    </td>
                    <td>
                      <b>{tokenMoney(data.tax.tax, c)}</b>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {data.tax.vatWarning && <p className="aw-bank-error">{data.tax.vatWarning}</p>}
            {data.tax.notes.map((n) => (
              <small key={n}>{n} </small>
            ))}
          </section>
        )}
        <section className="aw-summary-activity">
          <header>
            <b>By deal</b>
          </header>
          <div className="aw-summary-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Spent</th>
                  <th>Refunded</th>
                </tr>
              </thead>
              <tbody>
                {(data?.deals ?? []).map((d) => (
                  <tr key={d.title}>
                    <td>
                      <b>{d.title}</b>
                    </td>
                    <td className="debit">{tokenMoney(d.spent, c)}</td>
                    <td className="credit">{tokenMoney(d.refunded, c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>,
    lang,
  );
}

// ------------------------------------------------------------------------------------------
// Deal detail
// ------------------------------------------------------------------------------------------

type DealDetail = {
  id: number;
  title: string;
  summary: string | null;
  role: "buyer" | "seller";
  counterpartyLabel: string;
  counterparty: string;
  total: string;
  status: string;
  reviewHours: number;
  demoSeller: boolean;
  canCancel: boolean;
  canAccept: boolean;
  escrow: string | null;
  milestones: {
    index: number;
    name: string;
    acceptance: string | null;
    amount: string;
    status: string;
    deadline: number;
    moves: string[];
    delivery: { note: string; fileName: string | null; size: number | null; sha256: string; deliveredAt: string } | null;
    canDownload: boolean;
    deliverable: { text: string; sha256: string } | null;
    dispute: DisputeInfo | null;
  }[];
};

type DisputeInfo = {
  phase: "work" | "key";
  reason: string;
  status: "OPEN" | "DECIDING" | "NEEDS_REVIEW" | "RESOLVED";
  decision: "seller" | "buyer" | null;
  confidence: number | null;
  rationale: string | null;
  findings: { criterion: string; met: boolean; evidence: string }[] | null;
  decidedBy: string | null;
  txHash: string | null;
};

/** The neutral arbiter's view of a disputed milestone: the buyer's reason, then the ruling and why. */
export function ArbiterPanel({ d, role }: { d: DisputeInfo; role: "buyer" | "seller" }) {
  const by = d.decidedBy?.startsWith("ai:") ? `AI arbiter (${d.decidedBy.slice(3).split("/").pop()})` : d.decidedBy === "check:key" ? "Key check (no AI needed)" : d.decidedBy;
  const winner = d.decision === "seller" ? (role === "seller" ? "you are paid" : "the seller is paid") : role === "buyer" ? "you are refunded" : "the buyer is refunded";
  return (
    <div className="aw-arbiter">
      <small>⚖ NEUTRAL ARBITER · {d.phase === "key" ? "dispute about the released key" : "dispute about the work"}</small>
      <p>
        <b>Buyer&apos;s reason:</b> {d.reason}
      </p>
      {(d.status === "OPEN" || d.status === "DECIDING") && <p className="aw-arbiter-wait">Deciding… the arbiter compares the evidence with the acceptance criteria.</p>}
      {d.decision && (
        <>
          <p className={d.decision === "seller" ? "aw-arbiter-seller" : "aw-arbiter-buyer"}>
            <b>
              {d.status === "RESOLVED" ? "Ruling" : "Recommendation"}: {d.decision === "seller" ? "pay the seller" : "refund the buyer"}
            </b>
            {d.confidence !== null && ` · confidence ${Math.round(d.confidence * 100)}%`}
            {d.status === "RESOLVED" && ` · ${winner}`}
          </p>
          {d.rationale && <p>{d.rationale}</p>}
          {d.findings && d.findings.length > 0 && (
            <ul>
              {d.findings.map((f, i) => (
                <li key={i}>
                  {f.met ? "✓" : "✗"} <b>{f.criterion}</b> · {f.evidence}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {d.status === "NEEDS_REVIEW" && <p className="aw-arbiter-wait">Not confident enough to settle on its own: a human arbiter decides with these findings.</p>}
      <small>
        {by && `Decided by ${by}`}
        {d.txHash && (
          <>
            {" · "}
            <a href={`/explorer/tx/${d.txHash}`} target="_blank" rel="noreferrer">
              resolve tx ↗
            </a>
          </>
        )}
      </small>
    </div>
  );
}

function DisputeForm({ dealId, index, onDone, onCancel }: { dealId: number; index: number; onDone: () => Promise<void>; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await send<{ outcome: Outcome }>(`/api/deals/${dealId}/action`, "POST", { action: "dispute", index, reason });
      if (r.outcome.status !== "success") setMsg(r.outcome.error ?? r.outcome.status);
      else await onDone();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="aw-deliver-form" onSubmit={submit}>
      <label>
        <span>What does the delivery fail? Name the acceptance criterion. A neutral arbiter (not your agent) reads this, the seller&apos;s evidence and the terms, then pays the seller or refunds you.</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} required minLength={10} />
      </label>
      <div className="aw-d012-actions">
        <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 10}>
          {busy ? "Opening dispute…" : "Open dispute"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {msg && <p className="aw-bank-error">{msg}</p>}
    </form>
  );
}

/** The seller's delivery form for one milestone: evidence note plus an optional file (max 4 MB). */
function DeliverForm({ dealId, index, onDone }: { dealId: number; index: number; onDone: () => Promise<void> }) {
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
      form.set("index", String(index));
      form.set("note", note);
      if (file) form.set("file", file);
      const r = await api<{ outcome: Outcome; sha256: string }>(`/api/deals/${dealId}/deliver`, { method: "POST", body: form });
      if (r.outcome.status !== "success") setMsg({ ok: false, text: r.outcome.error ?? r.outcome.status });
      else {
        setMsg({ ok: true, text: `Delivered · sha256 ${r.sha256.slice(0, 12)}… anchored on-chain` });
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
    <form className="aw-deliver-form" onSubmit={submit}>
      <label>
        <span>Evidence: what you delivered and how it meets the acceptance criteria</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000} required />
      </label>
      <label>
        <span>File (optional, max 4 MB · encrypted, the buyer unlocks it after approving)</span>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <Button type="submit" disabled={busy || !note.trim()}>
        {busy ? "Encrypting & anchoring…" : "Submit delivery"}
      </Button>
      {msg && <p className={msg.ok ? "aw-live-ok" : "aw-bank-error"}>{msg.text}</p>}
    </form>
  );
}

const SELLER_STEP: Record<string, string> = {
  Pending: "Your turn: deliver the work",
  Delivered: "Delivered · waiting for the buyer's review",
  Approved: "Approved · the agent releases your key",
  KeyReleased: "Key released · payment on its way to your bank",
  Released: "Paid to your bank",
  Disputed: "Disputed · the neutral arbiter is deciding",
  Refunded: "Refunded to the buyer",
};

const STEP: Record<string, string> = {
  Pending: "Waiting for the seller to deliver",
  Delivered: "Delivered · your review",
  Approved: "Approved · waiting for the seller's key",
  KeyReleased: "File unlocked · confirming the key and paying the seller",
  Released: "Paid to the seller",
  Disputed: "Disputed · the neutral arbiter is deciding",
  Refunded: "Refunded to your bank",
};

export function LiveDealDetail({ dealId, go }: { dealId: string; go: (screen: string) => void }) {
  const lang = useLang();
  const { me, refresh } = useAppData();
  const id = Number(dealId.replace(/\D/g, ""));
  const { data, error, reload } = useApi<DealDetail>(Number.isFinite(id) ? `/api/deals/${id}` : null, 6000);
  const { busy, run, note } = useAction();
  const c = me?.bank.currency ?? "THB";
  const after = async () => {
    await reload();
    await refresh();
  };
  const [disputing, setDisputing] = useState<number | null>(null);
  const act = (action: string, index: number) => run(`${action}${index}`, () => send(`/api/deals/${id}/action`, "POST", { action, index }), after);

  return localizeMockupNode(
    <div className="aw-deal-detail-page">
      <BalanceBar />
      <div className="aw-d012-content">
        <header className="aw-d012-heading">
          <div>
            <small>
              DEAL D-{id} · {data ? `${tokenMoney(data.total, c)} · ${data.role === "buyer" ? "BUYING" : "SELLING"}` : "…"}
            </small>
            <h1>
              {data?.title ?? "…"} <span>{data?.status}</span>
            </h1>
            <p>
              {data?.role === "buyer" ? "Seller" : "Buyer"}: {data?.counterpartyLabel || data?.counterparty}
              {data?.demoSeller ? " (acts automatically for the demo)" : ""} · review window {data?.reviewHours ?? "…"} h
            </p>
          </div>
          <Button variant="outline" onClick={() => go("ดีลทั้งหมด")}>
            ← All deals
          </Button>
        </header>
        {error && <p className="aw-bank-error">{error}</p>}
        {note}
        {data?.summary && <p>{data.summary}</p>}
        <div className="aw-d012-columns">
          {data?.milestones.map((m) => (
            <section className="aw-d012-card" key={m.index}>
              <h2>
                {m.index + 1}. {m.name}
              </h2>
              <div className="aw-d012-payout">
                <span>{(data.role === "seller" ? SELLER_STEP : STEP)[m.status] ?? m.status}</span>
                <b>{tokenMoney(m.amount, c)}</b>
              </div>
              {m.acceptance && <p>Acceptance: {m.acceptance}</p>}
              {m.deadline > 0 && ["Delivered", "Approved", "KeyReleased"].includes(m.status) && <small>Window ends {when(m.deadline)}</small>}
              {m.delivery && (
                <div className="aw-d012-success">
                  📎 &nbsp;Evidence: {m.delivery.note}
                  {m.delivery.fileName && (
                    <>
                      <br />
                      File: {m.delivery.fileName} ({Math.ceil((m.delivery.size ?? 0) / 1024)} KB) · sha256 {m.delivery.sha256.slice(0, 12)}… (the work hash on-chain)
                    </>
                  )}
                  {m.canDownload ? (
                    <>
                      <br />
                      <Button variant="outline" onClick={() => download(`/api/deals/${id}/files/${m.index}`)}>
                        ⇩ Download file
                      </Button>
                    </>
                  ) : (
                    m.delivery.fileName && data.role === "buyer" && <small> · unlocks after you approve and the key is released</small>
                  )}
                </div>
              )}
              {m.moves.includes("deliver") && <DeliverForm dealId={id} index={m.index} onDone={after} />}
              {disputing === m.index && m.moves.includes("dispute") && (
                <DisputeForm
                  dealId={id}
                  index={m.index}
                  onCancel={() => setDisputing(null)}
                  onDone={async () => {
                    setDisputing(null);
                    await after();
                  }}
                />
              )}
              {m.dispute && <ArbiterPanel d={m.dispute} role={data.role} />}
              {m.deliverable && (
                <div className="aw-d012-success">
                  ✓ &nbsp;File: “{m.deliverable.text}” · sha256 {m.deliverable.sha256.slice(0, 12)}… matches the hash anchored on-chain
                </div>
              )}
              {m.moves.length > 0 && (
                <div className="aw-d012-actions">
                  {m.moves.includes("approve") && (
                    <Button disabled={!!busy} onClick={() => act("approve", m.index)}>
                      {busy === `approve${m.index}` ? "…" : "Approve work"}
                    </Button>
                  )}
                  {m.moves.includes("dispute") && disputing !== m.index && (
                    <Button variant="outline" disabled={!!busy} onClick={() => setDisputing(m.index)}>
                      Dispute
                    </Button>
                  )}
                  {m.moves.includes("reclaim") && (
                    <Button variant="outline" disabled={!!busy} onClick={() => act("reclaim", m.index)}>
                      Take money back
                    </Button>
                  )}
                  {m.moves.includes("refund") && (
                    <Button variant="outline" disabled={!!busy} onClick={() => act("refund", m.index)}>
                      Refund the buyer
                    </Button>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
        {data?.canAccept && (
          <div className="aw-d012-actions">
            <Button disabled={!!busy} onClick={() => act("accept", 0)}>
              {busy === "accept0"
                ? "…"
                : data.role === "buyer"
                  ? `Accept & pay ${tokenMoney(data.total, c)} from your bank`
                  : `Accept offer · ${tokenMoney(data.total, c)} is already locked by the buyer`}
            </Button>
          </div>
        )}
        {data?.canCancel && (
          <div className="aw-d012-actions">
            <Button variant="danger" disabled={!!busy} onClick={() => act("cancel", 0)}>
              {data.role === "buyer" ? "Cancel offer · refund to bank" : "Withdraw offer"}
            </Button>
          </div>
        )}
        {data?.escrow && (
          <small>
            Money is held by the escrow contract:{" "}
            <a href={data.escrow} target="_blank" rel="noreferrer">
              view on explorer ↗
            </a>{" "}
            · this page refreshes every few seconds
          </small>
        )}
      </div>
    </div>,
    lang,
  );
}
