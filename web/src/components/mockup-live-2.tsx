"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { localizeMockupNode, useLang } from "@/lib/i18n";

import { api, download, tokenMoney, useAppData } from "./app-data";
import { DisputeFlow, type DisputeFlowData, isStagedDispute } from "./dispute-flow";
import { BalanceBar } from "./mockup-live";
import { Button, Card, Loading, PageTitle } from "./mockup-ui";

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
        setMessage({ ok: false, text: r.status === "REFUNDED" ? `Not accepted · money refunded to your wallet${r.error ? ` (${r.error})` : ""}` : `Still processing (${r.status}) · try again in a moment` });
      else setMessage({ ok: true, text: "Done", url: o?.url });
      await done?.();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const note: ReactNode = busy ? (
    <Loading text="Working… signing and waiting for the chain (a few seconds)" />
  ) : message ? (
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
        {!data && !error && <Loading block text="Loading your approvals…" />}
        {note}
        <small className="aw-approvals-section-label">YOUR ACCOUNT</small>
        <div className="aw-approval-list">
          {data && data.offers.length + data.drafts.length + data.reviews.length === 0 && <p className="aw-approval-empty">Nothing waiting for you.</p>}
          {data?.drafts.map((d) => (
            <article className="aw-approval-item" key={d.id}>
              <span className="aw-approval-tier">T1</span>
              <div className="aw-approval-copy">
                <b>
                  <span className="aw-id-chip">DR-{d.id.slice(-6).toUpperCase()}</span> {d.side === "SELL" ? "Offer to sell" : "Lock"} “{d.title}” ·{" "}
                  {tokenMoney(d.total, currency)}
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
                  variant="outline"
                  disabled={!!busy || !address}
                  onClick={() => run(`x${d.id}`, () => send(`/api/workspace/${address}/drafts/${d.id}`, "DELETE"), after)}
                >
                  {busy === `x${d.id}` ? "…" : "Discard"}
                </Button>
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
                  <span className="aw-id-chip">D-{o.dealId}</span> Offer from {o.sellerLabel || o.seller} · {o.title} · {tokenMoney(o.amount, currency)}
                </b>
                <p>Accepting takes the total from your wallet and locks it in escrow until you approve each delivery.</p>
                <small>The seller must be one of your payees</small>
              </div>
              <div className="aw-approval-buttons">
                <Button variant="outline" onClick={() => (window.location.href = `/deals/D-${o.dealId}`)}>
                  Details
                </Button>
                <Button variant="outline" disabled={!!busy} onClick={() => run(`n${o.dealId}`, () => send(`/api/deals/${o.dealId}/decline`, "POST"), after)}>
                  {busy === `n${o.dealId}` ? "…" : "Decline"}
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
                  <span className="aw-id-chip">
                    D-{r.dealId} · M{r.index + 1}
                  </span>{" "}
                  Review delivery · {r.title} · {tokenMoney(r.amount, currency)}
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
                  onClick={() => (window.location.href = `/deals/D-${r.dealId}`)}
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
                  <span className="aw-id-chip">D-{t.dealId}</span> {t.step === "accept" ? "Accept offer" : "Deliver"} · {t.title} · {tokenMoney(t.amount, currency)}
                </b>
                <p>{t.step === "accept" ? "The buyer already locked the money in escrow." : "Upload the work and your evidence on the deal page."}</p>
              </div>
              <div className="aw-approval-buttons">
                {t.step === "accept" && (
                  <Button variant="outline" disabled={!!busy} onClick={() => run(`s${t.dealId}`, () => send(`/api/deals/${t.dealId}/decline`, "POST"), after)}>
                    {busy === `s${t.dealId}` ? "…" : "Decline"}
                  </Button>
                )}
                <Button onClick={() => (window.location.href = `/deals/D-${t.dealId}`)}>Open deal</Button>
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
        {!data && !error && <Loading block text="Reading your policy from the chain…" />}
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
                      {r.friendshipId ? " · contact" : ""}
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
            <p className="aw-friend-policy">ⓘ Add payees from Contacts. Nobody can be added by pasting an address.</p>
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

/** What the user calls their contacts: the AI learns these in chat; the user can remove them here. */
function Nicknames() {
  const { data, reload } = useApi<{ nicknames: { id: string; nickname: string; contact: string }[] }>("/api/friends/nicknames");
  const { busy, run, note } = useAction();
  return (
    <section className="aw-friends-panel">
      <header>
        <h2>Nicknames the AI remembers · {data?.nicknames.length ?? "…"}</h2>
      </header>
      <small>Call a contact by a nickname in the AI chat (e.g. &quot;my designer&quot;); once you tell it who you mean, it remembers in every chat.</small>
      {!data && <Loading text="Loading nicknames…" />}
      {data?.nicknames.length === 0 && <small>None yet.</small>}
      {data?.nicknames.map((n) => (
        <div className="aw-request-row" key={n.id}>
          <span className="aw-friend-name">
            <b>&quot;{n.nickname}&quot;</b>
            <small>means {n.contact}</small>
          </span>
          <Button variant="outline" disabled={!!busy} onClick={() => run(`n${n.id}`, () => send(`/api/friends/nicknames?id=${encodeURIComponent(n.id)}`, "DELETE"), reload)}>
            Forget
          </Button>
        </div>
      ))}
      {note}
    </section>
  );
}

export function LiveFriends() {
  const lang = useLang();
  const { data, error, reload } = useApi<{ friends: Friend[] }>("/api/friends");
  const { busy, run, note } = useAction();
  const [username, setUsername] = useState("");
  const [found, setFound] = useState<{ username: string; name: string }[]>([]);
  const friends = data?.friends ?? [];
  // Search as the user types: part of a username or a display name is enough.
  useEffect(() => {
    const q = username.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => {
      api<{ results: { username: string; name: string }[] }>(`/api/friends/search?q=${encodeURIComponent(q)}`)
        .then((r) => setFound(r.results))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [username]);
  const known = new Set(friends.map((f) => f.username));
  const add = (u: string) =>
    run(`add${u}`, () => send("/api/friends", "POST", { username: u }), async () => {
      setUsername("");
      setFound([]);
      await reload();
    });
  const incoming = friends.filter((f) => f.direction === "incoming");
  const outgoing = friends.filter((f) => f.direction === "outgoing");
  const mutual = friends.filter((f) => f.status === "ACCEPTED");

  return localizeMockupNode(
    <div className="aw-friends-page">
      <BalanceBar />
      <main className="aw-friends-content">
        <header className="aw-friends-heading">
          <div>
            <h1>Contacts</h1>
            <p>Add contacts who use Agentic Wallet to invite them to groups and make them payees</p>
          </div>
        </header>
        {error && <p className="aw-bank-error">{error}</p>}
        {!data && !error && <Loading block text="Loading contacts and payees…" />}
        {note}
        <div className="aw-friends-top">
          <section className="aw-friends-panel aw-find-friends">
            <h2>Add a contact</h2>
            <p>Type part of their name or username. Only wallets in your currency are found.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                // One match: add that person. Otherwise treat the text as an exact username.
                const target = found.length === 1 ? found[0].username : username.trim().toLowerCase();
                void run("add", () => send("/api/friends", "POST", { username: target }), async () => {
                  setUsername("");
                  setFound([]);
                  await reload();
                });
              }}
            >
              <label className="aw-friends-search">
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="name or bank username" />
              </label>
              <Button type="submit" disabled={!username || busy === "add"}>
                {busy === "add" ? "…" : "Send request"}
              </Button>
            </form>
            <div className="aw-friend-search-results">
              {username.trim().length >= 2 &&
                found.map((r) => (
                  <div className="aw-friend-result" key={`found-${r.username}`}>
                    <span className="aw-friend-avatar violet">{initials(r.name)}</span>
                    <span className="aw-friend-name">
                      <b>{r.name}</b>
                      <small>@{r.username}</small>
                    </span>
                    <Button variant="outline" disabled={!!busy || known.has(r.username)} onClick={() => void add(r.username)}>
                      {known.has(r.username) ? "Already added" : busy === `add${r.username}` ? "…" : "Send request"}
                    </Button>
                  </div>
                ))}
              {username.trim().length >= 2 && found.length === 0 && <small>No one matches “{username.trim()}”.</small>}
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
        <Nicknames />
        <section className="aw-friends-panel aw-friend-requests">
          <header>
            <h2>Contact requests</h2>
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
            <h2>My contacts · {mutual.length}</h2>
          </header>
          <div className="aw-friend-policy">ⓘ &nbsp; A contact is not automatically in your allowlist. Making someone a payee is an on-chain action you approve.</div>
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
                    {busy === `p${f.friendshipId}` ? "Updating the allowlist on-chain…" : f.allowlisted ? "Allowlisted ✓ · remove" : f.wallet ? "Add to allowlist" : "No wallet yet"}
                  </Button>
                  <Button variant="outline" disabled={!!busy} onClick={() => run(`u${f.friendshipId}`, () => send(`/api/friends/${f.friendshipId}`, "DELETE"), reload)}>
                    Remove contact
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
  myRole: "ADMIN" | "MEMBER";
  proposals: {
    id: string;
    proposerId: string;
    proposer: string;
    mine: boolean;
    title: string;
    status: string;
    dealId: number | null;
    yes: number;
    no: number;
    myVote: boolean | null;
    voters: { name: string; approve: boolean }[];
    milestones: { amount: string }[];
  }[];
};

const PROPOSAL_STATUS: Record<string, string> = {
  OPEN: "Voting",
  EXECUTED: "Approved · locked from the proposer's bank",
  REJECTED: "Rejected or withdrawn",
  FAILED: "Approved, but locking failed · the proposer's bank was refunded or never debited",
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
  // Only purchases lock money, so only they go to a vote.
  const openDrafts = drafts.filter((d) => d.status === "DRAFT" && d.side === "BUY");
  const size = members.length + 1;
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
        {!data && !error && <Loading block text="Loading groups…" />}
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
                      onChange={(e) => {
                        const next = e.target.checked ? [...members, f.userId] : members.filter((x) => x !== f.userId);
                        setMembers(next);
                        setThreshold((t) => Math.min(Math.max(t, 2), next.length + 1));
                      }}
                    />
                    <span>{f.name}</span>
                  </label>
                ))}
              </div>
              <label className="aw-create-field">
                <span>
                  Votes needed to lock a group deal (2 to {Math.max(2, size)} of {size} members, you included)
                </span>
                <input type="number" min={2} max={Math.max(2, size)} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
              </label>
              {members.length === 0 && <small>Choose at least one friend. Members must bank in {currency}.</small>}
              <Button type="submit" disabled={busy === "create" || !name || members.length === 0 || threshold < 2 || threshold > size}>
                {busy === "create" ? "…" : "Create group"}
              </Button>
            </form>
          </Card>
        )}
        <div className="aw-group-cards">
          {data?.groups.length === 0 && <p>No groups yet.</p>}
          {data?.groups.map((g) => (
            <article
              className={`aw-group-card${selected === g.id ? " active" : ""}`}
              key={g.id}
              onClick={() => setSelected(g.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelected(g.id);
              }}
              role="button"
              tabIndex={0}
              aria-pressed={selected === g.id}
            >
              <div className="aw-group-card-top">
                <span className="aw-group-icon">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="9" cy="8" r="3" />
                    <path d="M3.5 19v-1.5a5.5 5.5 0 0 1 11 0V19M16 5.5a3 3 0 0 1 0 5.8M17 14a4.5 4.5 0 0 1 3.5 4.4V19" />
                  </svg>
                </span>
                {(() => {
                  const mine = g.members.find((m) => m.userId === me?.user.id);
                  return mine && <span className={`aw-group-role ${mine.role === "ADMIN" ? "yellow" : "blue"}`}>{mine.role === "ADMIN" ? "Admin" : "Member"}</span>;
                })()}
              </div>
              <h2>{g.name}</h2>
              <p>
                {g.members.length} members · {g.threshold} of {g.members.length} approve
              </p>
              <div className="aw-group-members">
                <div>
                  {g.members.map((m, i) => (
                    <span key={m.userId} className={`aw-group-avatar c${i % 5}`} title={m.name}>
                      {initials(m.name)}
                    </span>
                  ))}
                </div>
                <small>
                  Open votes
                  <br />
                  <b>
                    {g.openProposals} · {g.currency}
                  </b>
                </small>
              </div>
              <footer>
                <Button variant="outline" onClick={() => setSelected(g.id)}>
                  Open group
                </Button>
              </footer>
            </article>
          ))}
        </div>
        {selected && !detail && <Loading text="Opening the group…" />}
        {selected && detail && (
          <section className="aw-group-live">
            <header className="aw-group-live-head">
              <div>
                <h2>{detail.name}</h2>
                <small>
                {detail.threshold} of {detail.members.length} members must approve a group deal ·{" "}
                  {detail.members.map((m) => `${m.name}${m.role === "ADMIN" ? " (admin)" : ""}`).join(", ")}
                </small>
              </div>
              <div className="aw-gw-actions">
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => {
                    if (!window.confirm(`Leave "${detail.name}"?`)) return;
                    void run("leave", () => send(`/api/groups/${detail.id}/leave`, "POST"), async () => {
                      setSelected(null);
                      await reload();
                    });
                  }}
                >
                  Leave group
                </Button>
                {detail.myRole === "ADMIN" && (
                  <Button
                    variant="danger"
                    disabled={!!busy}
                    onClick={() => {
                      if (!window.confirm(`Delete "${detail.name}" for everyone? Open votes end; drafts stay with their proposers.`)) return;
                      void run("delete", () => send(`/api/groups/${detail.id}`, "DELETE"), async () => {
                        setSelected(null);
                        await reload();
                      });
                    }}
                  >
                    Delete group
                  </Button>
                )}
              </div>
            </header>
            <Card className="aw-group-wallet-card aw-group-wallet-votes">
              <h3>Put a draft to the vote</h3>
              <p>
                Ask the AI in the chat to draft a purchase first. It stays on hold while the group votes (you cannot approve it alone), and it is paid from
                your wallet once {detail.threshold} members say yes.
              </p>
              {openDrafts.length === 0 && <small>No purchase drafts yet.</small>}
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
                    {tokenMoney(total(p.milestones), currency)} · proposed by {p.mine ? "you" : p.proposer} · {p.yes} yes / {p.no} no (needs {detail.threshold}) ·{" "}
                    {PROPOSAL_STATUS[p.status] ?? p.status}
                    {p.dealId !== null ? ` · deal D-${p.dealId}` : ""}
                  </small>
                  {p.voters.length > 0 && (
                    <small className="aw-gw-proposal-meta">{p.voters.map((v) => `${v.approve ? "✓" : "✗"} ${v.name}`).join(" · ")}</small>
                  )}
                </div>
                {p.status === "OPEN" && p.myVote === null && (
                  <div className="aw-gw-actions">
                    <Button variant="outline" disabled={!!busy} onClick={() => run(`n${p.id}`, () => send(`/api/groups/proposals/${p.id}/vote`, "POST", { approve: false }), reloadDetail)}>
                      {busy === `n${p.id}` ? "…" : "No"}
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
                {p.mine && p.status === "OPEN" && (
                  <Button variant="outline" disabled={!!busy} onClick={() => run(`w${p.id}`, () => send(`/api/groups/proposals/${p.id}/withdraw`, "POST"), reloadDetail)}>
                    {busy === `w${p.id}` ? "…" : "Withdraw"}
                  </Button>
                )}
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
        .filter((m) => !["Released", "Refunded", "Split"].includes(m.status))
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
            <p>Money in and out of your wallet this year, explained by AI</p>
          </div>
          <div className="aw-summary-controls">
            <Button onClick={() => download("/api/summary/export")}>⇩ Export CSV</Button>
          </div>
        </header>
        {error && <p className="aw-bank-error">{error}</p>}
        {!data && !error && <Loading block text="Adding up your money…" />}
        <div className="aw-summary-metrics">
          {(
            [
              ["Received", data?.totals.income, "Paid to you as a seller", "green"],
              ["Spent", data?.totals.spent, "Locked into deals from your wallet", "red"],
              ["Locked now", locked, "Still in escrow", "yellow"],
              ["Refunded", data?.totals.refunds, "Came back to your wallet", "blue"],
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
  kind: "HIRE" | "GOODS";
  shipTo: string | null;
  role: "buyer" | "seller";
  counterpartyLabel: string;
  counterparty: string;
  total: string;
  status: string;
  reviewHours: number;
  demoSeller: boolean;
  canCancel: boolean;
  canAccept: boolean;
  declined: "me" | "them" | null;
  escrow: string | null;
  milestones: {
    index: number;
    name: string;
    acceptance: string | null;
    amount: string;
    status: string;
    deadline: number;
    moves: string[];
    delivers: "file" | "parcel" | "note";
    canPreview: boolean;
    delivery: {
      note: string;
      fileName: string | null;
      size: number | null;
      sha256: string;
      deliveredAt: string;
      parcel: {
        carrier: string;
        carrierLabel: string;
        tracking: string;
        tracked: boolean;
        delivered: boolean | null;
        status: string;
        events: { code: number; status: string; location: string; at: string }[];
      } | null;
    } | null;
    canDownload: boolean;
    deliverable: { text: string; sha256: string } | null;
    dispute: (DisputeInfo & Partial<DisputeFlowData>) | null;
  }[];
};

type DisputeInfo = {
  phase: "work" | "key";
  reason: string;
  status: "OPEN" | "DECIDING" | "AWAITING" | "NEEDS_REVIEW" | "RESOLVED";
  decision: "seller" | "buyer" | "split" | null;
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
function DeliverForm({ dealId, index, parcel, onDone }: { dealId: number; index: number; parcel: boolean; onDone: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [carrier, setCarrier] = useState("MOCK_POST");
  const [tracking, setTracking] = useState("");
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
      if (parcel) {
        form.set("carrier", carrier);
        if (tracking.trim()) form.set("tracking", tracking.trim());
      }
      const r = await api<{ outcome: Outcome; sha256: string; tracking?: string }>(`/api/deals/${dealId}/deliver`, { method: "POST", body: form });
      if (r.outcome.status !== "success") setMsg({ ok: false, text: r.outcome.error ?? r.outcome.status });
      else {
        setMsg({
          ok: true,
          text: r.tracking
            ? `Shipped · tracking ${r.tracking} · the record's sha256 ${r.sha256.slice(0, 12)}… is anchored on-chain`
            : `Delivered · sha256 ${r.sha256.slice(0, 12)}… anchored on-chain`,
        });
        setTracking("");
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
  const booking = parcel && carrier === "MOCK_POST" && !tracking.trim();
  if (parcel) {
    return (
      <form className="aw-deliver-form" onSubmit={submit}>
        <label>
          <span>Carrier</span>
          <select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            <option value="MOCK_POST">Mock Post (Thailand Post sandbox) · tracked live</option>
            <option value="THAILAND_POST">Thailand Post</option>
            <option value="KERRY">Kerry Express</option>
            <option value="FLASH">Flash Express</option>
            <option value="OTHER">Other carrier</option>
          </select>
        </label>
        <label>
          <span>{carrier === "MOCK_POST" ? "Tracking number (leave empty to book a pickup and get one)" : "Tracking number"}</span>
          <input value={tracking} onChange={(e) => setTracking(e.target.value.toUpperCase())} placeholder="EF123456785TH" maxLength={30} required={carrier !== "MOCK_POST"} />
        </label>
        <label>
          <span>Note for the buyer (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} />
        </label>
        <Button type="submit" disabled={busy || (carrier !== "MOCK_POST" && !tracking.trim())}>
          {busy ? (booking ? "Booking with Mock Post…" : "Recording the shipment…") : booking ? "Book pickup & ship" : "Mark as shipped"}
        </Button>
        {msg && <p className={msg.ok ? "aw-live-ok" : "aw-bank-error"}>{msg.text}</p>}
      </form>
    );
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

type Parcel = NonNullable<NonNullable<DealDetail["milestones"][number]["delivery"]>["parcel"]>;

/** Where the parcel is: the carrier's tracking events as a timeline (Napat's v0.8 layout). */
function ParcelPanel({ p, shipTo, role, reviewing }: { p: Parcel; shipTo: string | null; role: "buyer" | "seller"; reviewing: boolean }) {
  const t = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  // Events arrive newest first; the timeline reads oldest first, ending at the latest one.
  const events = [...p.events].reverse();
  return (
    <div className="aw-parcel">
      <div className="aw-parcel-stats">
        <span>
          <small>Carrier</small>
          <b>{p.carrierLabel}</b>
        </span>
        <span>
          <small>Tracking number</small>
          <b>
            <code>{p.tracking}</code>
          </b>
        </span>
        <span>
          <small>Status</small>
          <b className={p.delivered ? "green" : "blue"}>{p.delivered ? "Delivered" : p.tracked ? (p.events[0]?.status ?? p.status) : p.status}</b>
        </span>
      </div>
      {shipTo && <p>Ship to: {shipTo}</p>}
      {p.tracked && (
        <ol className="aw-v08-tracking">
          {events.map((e, i) => {
            const last = i === events.length - 1;
            const state = p.delivered || !last ? "done" : "current";
            return (
              <li key={e.code} className={state}>
                <i>{state === "done" ? "✓" : i + 1}</i>
                <div>
                  <b>{e.status}</b>
                  <small>
                    {t(e.at)} · {e.location}
                  </small>
                </div>
              </li>
            );
          })}
          {!p.delivered && (
            <li className="pending">
              <i>{events.length + 1}</i>
              <div>
                <b>Delivered</b>
                <small>Waiting for the carrier</small>
              </div>
            </li>
          )}
        </ol>
      )}
      {p.delivered === true && (
        <p className="aw-parcel-ok">{role === "buyer" && reviewing ? "✓ Delivered. Check the item, then approve to pay the seller (or dispute)." : "✓ Delivered."}</p>
      )}
      {p.delivered === false && role === "buyer" && reviewing && <p>Not delivered yet. Approve only once you have the item.</p>}
    </div>
  );
}

const SELLER_STEP: Record<string, string> = {
  Pending: "Your turn: deliver the work",
  Delivered: "Delivered · waiting for the buyer's review",
  Approved: "Approved · the agent releases your key",
  KeyReleased: "Key released · payment on its way to your wallet",
  Released: "Paid to your wallet",
  Disputed: "Disputed · the neutral arbiter is deciding",
  Refunded: "Refunded to the buyer",
  Split: "Split by the arbiter · your share paid",
};

const STEP: Record<string, string> = {
  Pending: "Waiting for the seller to deliver",
  Delivered: "Delivered · your review",
  Approved: "Approved · waiting for the seller's key",
  KeyReleased: "File unlocked · confirming the key and paying the seller",
  Released: "Paid to the seller",
  Disputed: "Disputed · the neutral arbiter is deciding",
  Refunded: "Refunded to your wallet",
  Split: "Split by the arbiter · your share refunded",
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
              DEAL D-{id} ·{" "}
              {data
                ? `${tokenMoney(data.total, c)} · ${
                    data.kind === "HIRE" ? (data.role === "buyer" ? "HIRING (service)" : "HIRED (service)") : data.role === "buyer" ? "BUYING (goods)" : "SELLING (goods)"
                  }`
                : "…"}
            </small>
            <h1>
              {data?.title ?? "…"} <span>{data?.status}</span>
            </h1>
            <p>
              {data?.kind === "HIRE" ? (data.role === "buyer" ? "Contractor" : "Client") : data?.role === "buyer" ? "Seller" : "Buyer"}: {data?.counterpartyLabel || data?.counterparty}
              {data?.demoSeller ? " (acts automatically for the demo)" : ""} · review window {data?.reviewHours ?? "…"} h
            </p>
          </div>
          <Button variant="outline" onClick={() => go("ดีลทั้งหมด")}>
            ← All deals
          </Button>
        </header>
        {error && <p className="aw-bank-error">{error}</p>}
        {!data && !error && <Loading block text="Reading the deal from the chain…" />}
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
                  {m.canPreview && !m.canDownload && (
                    <div className="aw-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/deals/${id}/preview/${m.index}`} alt={`Watermarked preview of ${m.delivery.fileName ?? "the delivery"}`} loading="lazy" />
                      <small>Watermarked, reduced preview. The original unlocks once you approve and the key is released.</small>
                    </div>
                  )}
                  {m.canDownload ? (
                    <>
                      <br />
                      <Button variant="outline" onClick={() => download(`/api/deals/${id}/files/${m.index}`)}>
                        ⇩ Download file
                      </Button>
                    </>
                  ) : (
                    m.delivery.fileName && data.role === "buyer" && !m.canPreview && <small> · unlocks after you approve and the key is released</small>
                  )}
                </div>
              )}
              {m.delivery?.parcel && <ParcelPanel p={m.delivery.parcel} shipTo={data.shipTo} role={data.role} reviewing={m.status === "Delivered"} />}
              {!m.delivery?.parcel && m.delivers === "parcel" && data.shipTo && data.role === "seller" && <p>📦 Ship to: {data.shipTo}</p>}
              {m.moves.includes("deliver") && <DeliverForm dealId={id} index={m.index} parcel={m.delivers === "parcel"} onDone={after} />}
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
              {m.dispute &&
                (isStagedDispute(m.dispute) ? (
                  <DisputeFlow
                    d={m.dispute as DisputeFlowData}
                    role={data.role}
                    amount={m.amount}
                    money={(n) => tokenMoney(String(n), c)}
                    explorerTx={(h) => `/explorer/tx/${h}`}
                    onReply={async (reply, statement) => {
                      await send(`/api/deals/${id}/dispute`, "POST", { index: m.index, reply, statement });
                      await after();
                    }}
                  />
                ) : (
                  <ArbiterPanel d={m.dispute} role={data.role} />
                ))}
              {m.deliverable && (
                <div className="aw-d012-success">
                  ✓ &nbsp;File: “{m.deliverable.text}” · sha256 {m.deliverable.sha256.slice(0, 12)}… matches the hash anchored on-chain
                </div>
              )}
              {m.moves.length > 0 && (
                <div className="aw-d012-actions">
                  {m.moves.includes("approve") && (
                    <Button disabled={!!busy} onClick={() => act("approve", m.index)}>
                      {busy === `approve${m.index}` ? "…" : m.delivers === "parcel" ? "I received it · pay the seller" : data.kind === "GOODS" ? "Approve & unlock file" : "Approve work"}
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
        {data?.declined === "them" && (
          <p className="aw-bank-error">
            {data.role === "buyer" ? "The seller" : "The buyer"} declined this offer.{data.canCancel ? " Withdraw it to close the deal." : ""}
          </p>
        )}
        {data?.declined === "me" && <p className="aw-live-ok">You declined this offer. It stays open until the other side withdraws it; you can still accept it.</p>}
        {data?.canAccept && !data.declined && (
          <div className="aw-d012-actions">
            <Button variant="outline" disabled={!!busy} onClick={() => run("decline", () => send(`/api/deals/${id}/decline`, "POST"), after)}>
              Decline
            </Button>
          </div>
        )}
        {data?.canAccept && (
          <div className="aw-d012-actions">
            <Button disabled={!!busy} onClick={() => act("accept", 0)}>
              {busy === "accept0"
                ? "…"
                : data.role === "buyer"
                  ? `Accept & pay ${tokenMoney(data.total, c)} from your wallet`
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
