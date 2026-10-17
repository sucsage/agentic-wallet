"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { localizeMockupNode, useLang } from "@/lib/i18n";

import { api, download, tokenMoney, useAppData } from "./app-data";
import { DisputeFlow, type DisputeFlowData, isStagedDispute } from "./dispute-flow";
import { usePrefs } from "./prefs";
import { FundCompany, setActing } from "./company";
import { GroupChat } from "./group-chat";
import { SendMoneyDialog } from "./send-money";
import { BlockDialog, BlockedPanel, ReportDialog } from "./contact-safety";
import { DealDocuments, SiteMockup, WitnessPanel } from "./deal-extras";
import { SaveTemplateDialog, type TemplatePayload } from "./deal-templates";
import { SEND_LIMITS } from "@/lib/send-limits";
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
      const r = (await fn()) as { outcome?: Outcome; status?: string; error?: string; groupVote?: { status: string; yes: number; threshold: number; group: string } } | undefined;
      const o = r?.outcome;
      const v = r?.groupVote;
      if (v)
        setMessage({
          ok: v.status !== "FAILED" && v.status !== "REJECTED",
          text:
            v.status === "EXECUTED"
              ? `${v.group}'s signers approved it: done.`
              : v.status === "OPEN"
                ? `Sent to ${v.group}'s signers: ${v.yes} of ${v.threshold} yes so far. It happens when ${v.threshold} approve (they vote on the group's page).`
                : `The vote ${v.status.toLowerCase()}.`,
        });
      else if (r?.status === "OPEN" || r?.status === "EXECUTED") setMessage({ ok: true, text: r.status === "EXECUTED" ? "Approved and done" : "Your vote is counted" });
      else if (o && o.status !== "success") setMessage({ ok: false, text: o.error ?? o.status, url: o.url });
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
  const [prefs, savePrefs] = usePrefs();
  const { data, error, reload } = useApi<Policy>("/api/policy");
  const address = me?.wallets[0]?.address;
  const { data: state, reload: reloadState } = useApi<{ audit: AuditEntry[] }>(address ? `/api/workspace/${address}` : null);
  const { busy, run, note } = useAction();
  const currency = data?.token.currency ?? me?.bank.currency ?? "THB";

  return localizeMockupNode(
    <div className="aw-policy-page">
      <BalanceBar />
      <main className="aw-policy-content">
        <PageTitle title="Policy & Allow transfer list" description="The policy engine and the smart contract enforce the same rules" />
        {error && <p className="aw-bank-error">{error}</p>}
        {!data && !error && <Loading block text="Reading your policy from the chain…" />}
        {note}
        <section className="aw-policy-tiers">
          {[
            ["Tier 0", "Read", "Balance, deals, history", "green"],
            ["Tier 1", "Propose", "Lock money, add payees · you approve", "amber"],
            ["Tier 2", "Act alone", "Within limits and the allow transfer list only", "blue"],
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
              {/* Changed next to the AI agent on the chat page. */}
              <Button variant="outline" onClick={() => (window.location.href = "/chat")}>
                Change on the AI page →
              </Button>
            </header>
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
            <div className="aw-policy-limit">
              <span>Check balance before approval</span>
              <b className="aw-green">Always on</b>
            </div>
            <label className="aw-policy-limit">
              <span>A linked card covers a short balance</span>
              <input type="checkbox" role="switch" checked={prefs?.cardCover ?? true} disabled={!prefs} onChange={(e) => void savePrefs({ cardCover: e.target.checked })} />
            </label>
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
              <h2>Allow transfer list · who can be paid</h2>
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
  const [tab, setTab] = useState<"all" | "group" | "allow">("all");
  const [myQr, setMyQr] = useState<{ image: string; url: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendId, setSendId] = useState(() => crypto.randomUUID());
  const [reporting, setReporting] = useState<{ userId: string; name: string } | null>(null);
  const [blocking, setBlocking] = useState<{ userId: string; name: string } | null>(null);
  const [safetyMsg, setSafetyMsg] = useState<string | null>(null);
  const [blockVersion, setBlockVersion] = useState(0);
  const { me, refresh } = useAppData();
  const { data: groupsData } = useApi<{ groups: { members: { userId: string }[] }[] }>("/api/groups");
  const friends = data?.friends ?? [];
  // Someone scanned your "My code" QR: their page opens with your username ready to add.
  useEffect(() => {
    const add = new URLSearchParams(window.location.search).get("add");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (add) setUsername(add);
  }, []);
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
  const inMyGroups = new Set((groupsData?.groups ?? []).flatMap((g) => g.members.map((m) => m.userId)));
  const shown = mutual.filter((f) => (tab === "group" ? inMyGroups.has(f.userId) : tab === "allow" ? f.allowlisted : true));
  async function showMyCode() {
    const username = me?.user.username;
    if (!username) return;
    const url = `${window.location.origin}/contacts?add=${encodeURIComponent(username)}`;
    setMyQr({ url, image: await QRCode.toDataURL(url, { margin: 1, width: 200 }) });
  }

  return localizeMockupNode(
    <div className="aw-friends-page">
      <BalanceBar />
      <main className="aw-friends-content">
        <header className="aw-friends-heading">
          <div>
            <h1>Contacts</h1>
            <p>Add contacts who use Agentic Wallet to invite them to groups and make them payees</p>
          </div>
          <Button onClick={() => setSending(true)} disabled={!!me?.acting} title={me?.acting ? "Switch to Personal to send from your own wallet" : undefined}>
            ⇄ Send money
          </Button>
        </header>
        {sending && (
          <SendMoneyDialog
            title="Send money"
            intro="From your own wallet to one or several contacts at once. Everyone is paid together, or nobody is. Test money only."
            people={friends.filter((f) => f.status === "ACCEPTED").map((f) => ({ userId: f.userId, name: f.name }))}
            currency={me?.bank.currency ?? "THB"}
            submitLabel="Send now"
            limits={SEND_LIMITS}
            onClose={() => {
              setSending(false);
              setSendId(crypto.randomUUID());
            }}
            onSubmit={async (recipients) => {
              const r = await send<{ total: string; already: boolean }>("/api/transfers", "POST", { recipients, requestId: sendId });
              await refresh();
              return r.already ? "Already sent (this request was paid before)." : `Sent ${tokenMoney(Number(r.total) / 100, me?.bank.currency ?? "THB")} to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}.`;
            }}
          />
        )}
        {error && <p className="aw-bank-error">{error}</p>}
        {!data && !error && <Loading block text="Loading contacts and payees…" />}
        {note}
        <div className="aw-friends-top">
          <section className="aw-friends-panel aw-find-friends">
            <h2>Add a contact</h2>
            <p>Type part of their name or username, or their exact email. Only wallets in your currency are found.</p>
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
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="name, username or email" />
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
          <section className="aw-friends-panel aw-my-code">
            <h2>My code</h2>
            <p>Contacts scan this QR to add you{me?.user.username ? ` (@${me.user.username})` : ""}.</p>
            {myQr ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={myQr.image} alt="Your contact QR code" width={160} height={160} className="aw-gr-qr" />
                <small>{myQr.url}</small>
              </>
            ) : (
              <Button variant="outline" disabled={!me?.user.username} onClick={() => void showMyCode()}>
                Show my QR
              </Button>
            )}
          </section>
        </div>
        <section className="aw-friends-panel">
          <h2>Someone without an account?</h2>
          <p>
            Ask the AI to draft the deal with their name (hiring them, or selling to them). Nothing is sent yet: when you press Confirm, their private link is made, shown to you,
            and kept on the deal&apos;s page to send them. They need no sign-up.
          </p>
        </section>
        {safetyMsg && <p className="aw-live-ok aw-safety-msg">{safetyMsg}</p>}
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
                <Button variant="outline" disabled={!!busy} onClick={() => setBlocking({ userId: f.userId, name: f.name })}>
                  Block
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
            <div className="aw-deals-tabs" role="tablist" aria-label="Filter contacts">
              {(
                [
                  ["all", `All ${mutual.length}`],
                  ["group", `Same group ${mutual.filter((f) => inMyGroups.has(f.userId)).length}`],
                  ["allow", `Allow transfer list ${mutual.filter((f) => f.allowlisted).length}`],
                ] as const
              ).map(([k, label]) => (
                <button type="button" role="tab" key={k} aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
          </header>
          <div className="aw-friend-policy">ⓘ &nbsp; A contact is not automatically on your allow transfer list. Making someone a payee is an on-chain action you approve.</div>
          <div className="aw-friend-cards">
            {shown.length === 0 && <small>No contacts here.</small>}
            {shown.map((f) => (
              <article key={f.friendshipId}>
                <div className="aw-friend-card-head">
                  <span className="aw-friend-avatar violet">{initials(f.name)}</span>
                  <span>
                    <b>{f.name}</b>
                    <small>@{f.username}</small>
                  </span>
                </div>
                <div className="aw-friend-tags">{f.allowlisted && <span className="allow">allow transfer</span>}</div>
                <div className="aw-friend-card-actions">
                  <Button onClick={() => (window.location.href = `/chat?draft=${encodeURIComponent(`Hire ${f.name} for `)}`)}>New deal</Button>
                  <Button
                    variant="outline"
                    disabled={!!busy || !f.wallet}
                    onClick={() => run(`p${f.friendshipId}`, () => send(`/api/friends/${f.friendshipId}/payee`, "PUT", { allowed: !f.allowlisted }), reload)}
                  >
                    {busy === `p${f.friendshipId}` ? "Updating the allow transfer list on-chain…" : f.allowlisted ? "On allow transfer list ✓ · remove" : f.wallet ? "Add to allow transfer list" : "No wallet yet"}
                  </Button>
                  <Button variant="outline" disabled={!!busy} onClick={() => run(`u${f.friendshipId}`, () => send(`/api/friends/${f.friendshipId}`, "DELETE"), reload)}>
                    Remove contact
                  </Button>
                </div>
                <div className="aw-friend-safety">
                  <button type="button" onClick={() => setReporting({ userId: f.userId, name: f.name })}>
                    ⚑ Report
                  </button>
                  <button type="button" onClick={() => setBlocking({ userId: f.userId, name: f.name })}>
                    ⦸ Block
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <BlockedPanel
          version={blockVersion}
          onChange={(m) => {
            setSafetyMsg(m);
            void reload();
          }}
        />
        {blocking && (
          <BlockDialog
            person={blocking}
            onClose={() => setBlocking(null)}
            onDone={(m) => {
              setSafetyMsg(m);
              setBlockVersion((v) => v + 1);
              void reload();
            }}
          />
        )}
        {reporting && (
          <ReportDialog
            person={reporting}
            onClose={() => setReporting(null)}
            onDone={(m) => {
              setSafetyMsg(m);
              setBlockVersion((v) => v + 1);
              void reload();
            }}
          />
        )}
      </main>
    </div>,
    lang,
  );
}



// ------------------------------------------------------------------------------------------
// Groups
// ------------------------------------------------------------------------------------------

type GroupMemberView = { userId: string; name: string; role: string; canSign?: boolean };
type GroupSummary = {
  id: string;
  name: string;
  currency: string;
  threshold: number;
  members: GroupMemberView[];
  openProposals: number;
  invited?: number;
  company?: { id: string; kind: "COMPANY" | "GROUP"; name: string } | null;
};
type GroupInviteView = { id: string; groupId: string; name: string; company: string | null; members: number; threshold: number; canSign: boolean; invitedBy: string };
type GroupDetail = {
  id: string;
  name: string;
  currency: string;
  threshold: number;
  myRole: "ADMIN" | "MEMBER";
  iSign: boolean;
  signers: number;
  company: { id: string; kind: "COMPANY" | "GROUP"; name: string; maskedTaxId: string | null; wallet: string; accountNo: string | null; balance: string } | null;
  stats: { committed: number; deals: number; openVotes: number };
  members: (GroupMemberView & { joinedAt: string })[];
  invites: { id: string; userId: string; name: string; canSign: boolean }[];
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
    side: "BUY" | "SELL" | "PAYOUT" | "RELEASE";
    payout: { name: string; amount: number }[];
  }[];
  rules: { id: string; kind: string; text: string; status: string; proposer: string; yes: number; no: number; myVote: boolean | null }[];
  activity: { at: string; text: string }[];
};

const PROPOSAL_STATUS: Record<string, string> = {
  OPEN: "Voting",
  EXECUTED: "Approved · locked",
  REJECTED: "Rejected or withdrawn",
  FAILED: "Approved, but locking failed · nothing was debited (or it was refunded)",
};

const roleOf = (m: { role: string; canSign?: boolean }) => (m.role === "ADMIN" ? "Owner" : m.canSign === false ? "Member" : "Signer");

/** Who to invite, and as what: a signer (votes on payments) or a member (proposes only). */
function RolePicker({ friends, picked, setPicked }: { friends: Friend[]; picked: Record<string, "signer" | "member">; setPicked: (p: Record<string, "signer" | "member">) => void }) {
  if (friends.length === 0) return <small>Add contacts first.</small>;
  return (
    <div className="aw-gr-picker">
      {friends.map((f) => (
        <div key={f.userId}>
          <span>{f.name}</span>
          {(["", "signer", "member"] as const).map((r) => (
            <button
              type="button"
              key={r || "none"}
              aria-pressed={(picked[f.userId] ?? "") === r}
              onClick={() => {
                const next = { ...picked };
                if (r) next[f.userId] = r;
                else delete next[f.userId];
                setPicked(next);
              }}
            >
              {r === "" ? "—" : r === "signer" ? "Signer" : "Member"}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Reads a QR code from a photo (the group's join QR). */
async function readQrImage(file: File): Promise<string | null> {
  const { default: jsQR } = await import("jsqr");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height)?.data ?? null;
}

/** Opens a join link (/groups/join/<token>): shows the group and joins as a member. */
function JoinGroup({ token, onJoined, onClose }: { token: string; onJoined: (groupId: string) => void; onClose: () => void }) {
  const { data, error } = useApi<{ name: string; company: string | null; members: number; currency: string; sharedBy: string; expiresAt: string }>(`/api/groups/join/${token}`);
  const { busy, run, note } = useAction();
  return (
    <Card className="aw-group-panel aw-gr-join">
      <h2>Group invite</h2>
      {error && <p className="aw-bank-error">{error}</p>}
      {!data && !error && <Loading text="Checking the invitation…" />}
      {data && (
        <>
          <p>
            <b>{data.name}</b>
            {data.company ? ` · company ${data.company}` : ""} · {data.members} members · pays in {data.currency}
          </p>
          <small>
            Shared by {data.sharedBy} · valid until {new Date(data.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. You join as a member: you can propose
            payments; the signers decide.
          </small>
          <div className="aw-actions">
            <Button disabled={!!busy} onClick={() => run("join", () => send<{ groupId: string }>(`/api/groups/join/${token}`, "POST"), async () => onJoined(""))}>
              {busy === "join" ? "Joining…" : "Join"}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Not now
            </Button>
          </div>
        </>
      )}
      {note}
    </Card>
  );
}

export function LiveGroups({ initialCreateOpen = false, joinToken = null }: { initialCreateOpen?: boolean; joinToken?: string | null }) {
  const lang = useLang();
  const { me, drafts, refresh } = useAppData();
  const { data, error, reload } = useApi<{ groups: GroupSummary[] }>("/api/groups");
  const { data: invitesData, reload: reloadInvites } = useApi<{ invites: GroupInviteView[] }>("/api/groups/invites");
  const { data: friendsData } = useApi<{ friends: Friend[] }>("/api/friends");
  const [selected, setSelected] = useState<string | null>(null);
  const { data: loaded, error: detailError, reload: reloadDetail } = useApi<GroupDetail>(selected ? `/api/groups/${selected}` : null, selected ? 8000 : undefined);
  // Only the selected group's wallet: right after switching, the previous one is still loaded.
  const detail = loaded?.id === selected ? loaded : null;
  const detailShown = Boolean(selected && detail);
  // The wallet opens below the cards and panels, out of view: bring it up when it opens.
  useEffect(() => {
    if (selected) document.getElementById("aw-group-wallet")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected, detailShown]);
  const { busy, run, note } = useAction();
  const [creating, setCreating] = useState(initialCreateOpen);
  const [joining, setJoining] = useState<string | null>(joinToken);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Record<string, "signer" | "member">>({});
  const [threshold, setThreshold] = useState(2);
  const [draftId, setDraftId] = useState("");
  const [qr, setQr] = useState<{ url: string; image: string; expiresAt: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [invitePick, setInvitePick] = useState<Record<string, "signer" | "member">>({});
  const [rule, setRule] = useState<{ kind: string; target: string; threshold: number }>({ kind: "SET_THRESHOLD", target: "", threshold: 2 });
  const [qrError, setQrError] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const [payingOut, setPayingOut] = useState(false);
  const currency = me?.bank.currency ?? "THB";
  const friends = (friendsData?.friends ?? []).filter((f) => f.status === "ACCEPTED");
  // A personal purchase locks money, so it goes to a vote; in a company's or group wallet's name
  // (Acting as) its offers to sell go to the vote too.
  const openDrafts = drafts.filter((d) => d.status === "DRAFT" && (d.side === "BUY" || !!me?.acting));
  const signers = 1 + Object.values(picked).filter((r) => r === "signer").length;
  const total = (ms: { amount: string }[]) => ms.reduce((t, m) => t + Number(m.amount), 0);
  const invites = invitesData?.invites ?? [];
  const afterChange = async () => {
    await reloadDetail();
    await reload();
    await refresh();
  };

  async function shareLink(groupId: string) {
    const r = await send<{ url: string; expiresAt: string }>(`/api/groups/${groupId}/link`, "POST");
    setQr({ url: r.url, expiresAt: r.expiresAt, image: await QRCode.toDataURL(r.url, { margin: 1, width: 220 }) });
  }
  async function scan(file: File | undefined) {
    setQrError(null);
    if (!file) return;
    const text = await readQrImage(file).catch(() => null);
    const token = text?.match(/\/groups\/join\/([\w-]+)/)?.[1];
    if (!token) return setQrError("No group invitation QR found in that picture.");
    setJoining(token);
  }

  return localizeMockupNode(
    <div className="aw-groups-page">
      <BalanceBar />
      <main className="aw-groups-content">
        <header className="aw-groups-heading">
          <div>
            <h1>Groups</h1>
            <p>Pay together with shared approvals. A company group pays from the company account; any other group pays from the proposer&apos;s wallet.</p>
          </div>
          <Button onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "＋ Create group"}</Button>
        </header>
        {error && <p className="aw-bank-error">{error}</p>}
        {!data && !error && <Loading block text="Loading groups…" />}
        {note}
        {joining && (
          <JoinGroup
            token={joining}
            onClose={() => setJoining(null)}
            onJoined={async () => {
              setJoining(null);
              await afterChange();
            }}
          />
        )}
        {creating && (
          <Card className="aw-group-panel">
            <h2>Create a group</h2>
            <form
              className="aw-gr-form"
              onSubmit={(e) => {
                e.preventDefault();
                const members = Object.entries(picked).map(([userId, r]) => ({ userId, canSign: r === "signer" }));
                void run("create", () => send("/api/groups", "POST", { name, members, threshold }), async () => {
                  setCreating(false);
                  setName("");
                  setPicked({});
                  await reload();
                });
              }}
            >
              <label className="aw-create-field">
                <span>Group name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="e.g. PLC Team" />
              </label>
              <small>Invite contacts as signers (they vote on payments) or members (they propose). They join by accepting.</small>
              <RolePicker friends={friends} picked={picked} setPicked={setPicked} />
              <label className="aw-create-field">
                <span>Signers needed to approve a payment</span>
                <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
                  {Array.from({ length: Math.max(1, signers - 1) }, (_, i) => i + 2).map((n) => (
                    <option key={n} value={n} disabled={n > signers}>
                      {n} of {signers} signers (you included)
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" disabled={busy === "create" || !name || Object.keys(picked).length === 0 || signers < 2 || threshold > signers}>
                {busy === "create" ? "…" : "Create group"}
              </Button>
            </form>
          </Card>
        )}
        <div className="aw-group-cards">
          {data?.groups.length === 0 && <p>No groups yet.</p>}
          {data?.groups.map((g) => {
            const mine = g.members.find((m) => m.userId === me?.user.id);
            const signerCount = g.members.filter((m) => m.canSign !== false).length;
            return (
              <article className={`aw-group-card${selected === g.id ? " active" : ""}`} key={g.id}>
                <div className="aw-group-card-top">
                  <span className="aw-group-icon">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="9" cy="8" r="3" />
                      <path d="M3.5 19v-1.5a5.5 5.5 0 0 1 11 0V19M16 5.5a3 3 0 0 1 0 5.8M17 14a4.5 4.5 0 0 1 3.5 4.4V19" />
                    </svg>
                  </span>
                  {mine && <span className={`aw-group-role ${mine.role === "ADMIN" ? "yellow" : mine.canSign === false ? "" : "blue"}`}>{roleOf(mine)}</span>}
                </div>
                <h2>{g.name}</h2>
                <p>
                  {g.members.length} members · {g.threshold} of {signerCount} approve{g.invited ? ` · ${g.invited} invited` : ""}
                </p>
                <div className="aw-group-members">
                  <div>
                    {g.members.map((m, i) => (
                      <span key={m.userId} className={`aw-group-avatar c${i % 5}`} title={`${m.name} · ${roleOf(m)}`}>
                        {initials(m.name)}
                      </span>
                    ))}
                  </div>
                  <small>
                    Pays from
                    <br />
                    <b>{g.company ? `${g.company.kind === "GROUP" ? "Group wallet" : "Company"} · ${g.company.name}` : "the proposer's wallet"}</b>
                  </small>
                </div>
                <footer>
                  <Button variant="outline" onClick={() => setSelected(g.id)}>
                    Open group wallet
                  </Button>
                  <Button variant="outline" disabled={!!busy} onClick={() => run(`qr${g.id}`, () => shareLink(g.id))}>
                    Invite
                  </Button>
                </footer>
              </article>
            );
          })}
        </div>
        <div className="aw-groups-bottom">
          <section className="aw-group-panel aw-group-join">
            <h2>Join with a QR</h2>
            <p>Groups are private. Scan the invitation QR a member shows you (or upload a photo of it).</p>
            <label className="aw-button aw-gr-upload">
              <input type="file" accept="image/*" capture="environment" onChange={(e) => void scan(e.target.files?.[0])} />
              Scan or upload QR
            </label>
            {qrError && <small className="aw-bank-error">{qrError}</small>}
          </section>
          <section className="aw-group-panel aw-group-invites">
            <header>
              <h2>Invites for you</h2>
              <span className="aw-gw-count">{invites.length}</span>
            </header>
            {invites.length === 0 && <small>No invitations.</small>}
            {invites.map((i) => (
              <div className="aw-gr-invite" key={i.id}>
                <span className="aw-group-avatar c1">{initials(i.invitedBy)}</span>
                <span>
                  <b>
                    {i.invitedBy} invited you to “{i.name}”
                  </b>
                  <small>
                    {i.company ? `Company account · ` : ""}
                    {i.members} members · {i.threshold} signers approve · you join as a {i.canSign ? "signer" : "member"}
                  </small>
                </span>
                <span className="aw-gw-actions">
                  <Button variant="outline" disabled={!!busy} onClick={() => run(`d${i.id}`, () => send(`/api/groups/invites/${i.id}`, "POST", { accept: false }), reloadInvites)}>
                    Decline
                  </Button>
                  <Button
                    disabled={!!busy}
                    onClick={() =>
                      run(`a${i.id}`, () => send(`/api/groups/invites/${i.id}`, "POST", { accept: true }), async () => {
                        await reloadInvites();
                        await afterChange();
                      })
                    }
                  >
                    Join
                  </Button>
                </span>
              </div>
            ))}
          </section>
        </div>
        {qr && (
          <div className="aw-co-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setQr(null)}>
            <section className="aw-co-dialog" role="dialog" aria-modal="true" aria-label="Group invitation QR">
              <header>
                <h2>Invitation QR</h2>
                <button type="button" aria-label="Close" onClick={() => setQr(null)}>
                  ×
                </button>
              </header>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.image} alt="QR code to join the group" width={220} height={220} className="aw-gr-qr" />
              <p>Show this to someone in person, or send the link. Whoever opens it joins as a member (not a signer). Valid until {new Date(qr.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.</p>
              <input readOnly value={qr.url} onFocus={(e) => e.target.select()} />
            </section>
          </div>
        )}
        {selected && !detail && (
          <div id="aw-group-wallet">{detailError ? <p className="aw-bank-error">{detailError}</p> : <Loading text="Opening the group…" />}</div>
        )}
        {selected && detail && (
          <section className="aw-group-live" id="aw-group-wallet">
            {funding && detail.company && (
              <FundCompany
                company={{ id: detail.company.id, name: detail.company.name, currency, kind: detail.company.kind }}
                onDone={() => void afterChange()}
                onClose={() => setFunding(false)}
              />
            )}
            {payingOut && detail.company && (
              <SendMoneyDialog
                title={`Pay out from ${detail.name}`}
                intro={`From the group account (${tokenMoney(Number(detail.company.balance) / 100, currency)}) to members, e.g. to share what a sale earned. It goes to the vote: paid once ${detail.threshold} signers approve. Your yes counts now.`}
                people={detail.members.map((m) => ({ userId: m.userId, name: m.userId === me?.user.id ? `${m.name} (you)` : m.name }))}
                currency={currency}
                submitLabel="Propose payout"
                onClose={() => setPayingOut(false)}
                onSubmit={async (recipients) => {
                  const r = await send<{ status: string; yes: number }>(`/api/groups/${detail.id}/payouts`, "POST", { recipients });
                  await afterChange();
                  return r.status === "EXECUTED" ? "Approved and paid out." : `Put to the vote: ${r.yes} of ${detail.threshold} yes so far.`;
                }}
              />
            )}
            <header className="aw-group-live-head">
              <div>
                <small className="aw-gr-eyebrow">GROUP WALLET · {roleOf({ role: detail.myRole, canSign: detail.iSign }).toUpperCase()}</small>
                <h2>{detail.name}</h2>
                <small>
                  {detail.threshold} of {detail.signers} signers must approve a payment or a rule change
                  {detail.company?.maskedTaxId ? ` · company reg. ${detail.company.maskedTaxId}` : ""}
                </small>
              </div>
              <div className="aw-gw-actions">
                <Button variant="outline" disabled={!!busy} onClick={() => run(`qr${detail.id}`, () => shareLink(detail.id))}>
                  ♧ Invite by QR
                </Button>
                <Button variant="outline" onClick={() => setInviting((v) => !v)}>
                  {inviting ? "Close" : "Invite contacts"}
                </Button>
              </div>
            </header>
            <div className="aw-gr-stats">
              <div>
                <small>Pays from</small>
                <b>{detail.company ? tokenMoney(Number(detail.company.balance) / 100, currency) : "Proposer's wallet"}</b>
                <small>{detail.company ? `${detail.company.kind === "GROUP" ? "Group" : "Company"} account ${detail.company.accountNo ?? ""}` : "Each payment is taken from whoever proposed it"}</small>
                {detail.company ? (
                  <span className="aw-gw-wallet-actions">
                    {me?.acting?.companyId !== detail.company.id && (
                      <Button variant="outline" onClick={() => void setActing(detail.company!.id)}>
                        Act as {detail.company.name}
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => setFunding(true)}>
                      Add money
                    </Button>
                    {detail.iSign && (
                      <Button variant="outline" onClick={() => setPayingOut(true)}>
                        Pay out to members
                      </Button>
                    )}
                  </span>
                ) : detail.myRole === "ADMIN" ? (
                  <span className="aw-gw-wallet-actions">
                    <Button
                      disabled={!!busy}
                      onClick={() => {
                        if (!window.confirm(`Open a shared wallet for "${detail.name}"? The group can then hire and sell in its own name; its money moves only after ${detail.threshold} signers approve.`)) return;
                        void run("gwallet", () => send(`/api/groups/${detail.id}/wallet`, "POST"), afterChange);
                      }}
                    >
                      {busy === "gwallet" ? "Opening the wallet (about 10 s)…" : "Open a group wallet"}
                    </Button>
                    <small>To hire or sell in the group&apos;s name</small>
                  </span>
                ) : (
                  <small>The owner can open a group wallet to hire and sell in the group&apos;s name.</small>
                )}
              </div>
              <div>
                <small>Paid through the group</small>
                <b>{tokenMoney(detail.stats.committed, currency)}</b>
                <small>{detail.stats.deals} deals locked by vote</small>
              </div>
              <div>
                <small>Waiting for votes</small>
                <b className="amber">{detail.stats.openVotes + detail.rules.filter((r) => r.status === "OPEN").length}</b>
                <small>payments and rule changes</small>
              </div>
            </div>
            {inviting && (
              <Card className="aw-group-panel">
                <h3>Invite contacts</h3>
                <RolePicker friends={friends.filter((f) => !detail.members.some((m) => m.userId === f.userId) && !detail.invites.some((i) => i.userId === f.userId))} picked={invitePick} setPicked={setInvitePick} />
                {detail.myRole !== "ADMIN" && <small>Only an owner invites signers; you can invite members.</small>}
                <Button
                  disabled={!!busy || Object.keys(invitePick).length === 0}
                  onClick={() =>
                    run("invite", () => send(`/api/groups/${detail.id}/invite`, "POST", { members: Object.entries(invitePick).map(([userId, r]) => ({ userId, canSign: r === "signer" })) }), async () => {
                      setInvitePick({});
                      setInviting(false);
                      await reloadDetail();
                    })
                  }
                >
                  Send invitations
                </Button>
              </Card>
            )}
            <div className="aw-gr-columns">
              <Card className="aw-group-panel">
                <h3>Members</h3>
                {detail.members.map((m, i) => (
                  <div className="aw-gr-member" key={m.userId}>
                    <span className={`aw-group-avatar c${i % 5}`}>{initials(m.name)}</span>
                    <span>
                      <b>
                        {m.name}
                        {m.userId === me?.user.id ? " (you)" : ""}
                      </b>
                      <small>{m.canSign === false ? "Can propose" : "Can approve payments"}</small>
                    </span>
                    <span className={`aw-group-role ${m.role === "ADMIN" ? "yellow" : m.canSign === false ? "" : "blue"}`}>{roleOf(m)}</span>
                    {detail.myRole === "ADMIN" && m.role !== "ADMIN" && (
                      <span className="aw-gr-owner-actions">
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => void run(`sign${m.userId}`, () => send(`/api/groups/${detail.id}/members/${m.userId}`, "PATCH", { canSign: m.canSign === false }), afterChange)}
                        >
                          {m.canSign === false ? "Make signer" : "Stop signing"}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={!!busy}
                          onClick={() => {
                            if (!window.confirm(`Remove ${m.name} from "${detail.name}"?`)) return;
                            void run(`kick${m.userId}`, () => send(`/api/groups/${detail.id}/members/${m.userId}`, "DELETE"), afterChange);
                          }}
                        >
                          Remove
                        </button>
                      </span>
                    )}
                  </div>
                ))}
                {detail.myRole === "ADMIN" && <small className="aw-gr-muted">As the owner you change signers and remove members directly; other members propose changes for a vote.</small>}
                {detail.invites.map((i) => (
                  <div className="aw-gr-member pending" key={i.id}>
                    <span className="aw-group-avatar">{initials(i.name)}</span>
                    <span>
                      <b>{i.name}</b>
                      <small>Invited as a {i.canSign ? "signer" : "member"} · not joined yet</small>
                    </span>
                  </div>
                ))}
              </Card>
              <Card className="aw-group-panel">
                <h3>Group rules</h3>
                <p className="aw-gr-muted">
                  {detail.threshold} of {detail.signers} signers approve · {detail.company ? `pays from the ${detail.company.kind === "GROUP" ? "group" : "company"} account` : "pays from the proposer's wallet"}. Changing a rule needs the same vote.
                </p>
                <div className="aw-gr-rule">
                  <select value={rule.kind} onChange={(e) => setRule({ ...rule, kind: e.target.value })}>
                    <option value="SET_THRESHOLD">Change votes needed</option>
                    <option value="ADD_SIGNER">Make a member a signer</option>
                    <option value="REMOVE_SIGNER">Stop someone signing</option>
                    <option value="REMOVE_MEMBER">Remove someone</option>
                  </select>
                  {rule.kind === "SET_THRESHOLD" ? (
                    <select value={rule.threshold} onChange={(e) => setRule({ ...rule, threshold: Number(e.target.value) })}>
                      {Array.from({ length: Math.max(1, detail.signers - 1) }, (_, i) => i + 2).map((n) => (
                        <option key={n} value={n}>
                          {n} of {detail.signers}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select value={rule.target} onChange={(e) => setRule({ ...rule, target: e.target.value })}>
                      <option value="">Who…</option>
                      {detail.members
                        .filter((m) => m.userId !== me?.user.id && (rule.kind === "ADD_SIGNER" ? m.canSign === false : m.role !== "ADMIN" && (rule.kind === "REMOVE_SIGNER" ? m.canSign !== false : true)))
                        .map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  )}
                  <Button
                    variant="outline"
                    disabled={!!busy || (rule.kind !== "SET_THRESHOLD" && !rule.target)}
                    onClick={() =>
                      run(
                        "rule",
                        () =>
                          send(`/api/groups/${detail.id}/rules`, "POST", rule.kind === "SET_THRESHOLD" ? { kind: rule.kind, threshold: rule.threshold } : { kind: rule.kind, targetUserId: rule.target }),
                        afterChange,
                      )
                    }
                  >
                    Propose change
                  </Button>
                </div>
              </Card>
            </div>
            <GroupChat groupId={detail.id} threshold={detail.threshold} shared={detail.company?.name ?? null} />
            <Card className="aw-group-wallet-card aw-group-wallet-votes">
              <h3>＋ Propose a payment</h3>
              <p>
                {detail.company
                  ? `Ask the AI (here in the group chat, or acting as ${detail.company.name}) to hire or sell in the group's name; it happens once ${detail.threshold} signers approve. Purchases are paid from the ${detail.company.kind === "GROUP" ? "group" : "company"} account and sales are paid into it.`
                  : `Draft a purchase in the AI chat first. It stays on hold while the group votes, and is paid from your wallet once ${detail.threshold} signers approve.`}
              </p>
              {openDrafts.length === 0 && <small>No purchase drafts {me?.acting ? `for ${me.acting.name}` : "of yours"} yet.</small>}
              <select value={draftId} onChange={(e) => setDraftId(e.target.value)}>
                <option value="">Choose a draft…</option>
                {openDrafts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} · {tokenMoney(d.total, currency)}
                  </option>
                ))}
              </select>
              <Button
                disabled={!draftId || busy === "propose"}
                onClick={() =>
                  run("propose", () => send(`/api/groups/${detail.id}/proposals`, "POST", { draftId }), async () => {
                    setDraftId("");
                    await afterChange();
                  })
                }
              >
                {busy === "propose" ? "…" : "Propose to group"}
              </Button>
            </Card>
            <h3 className="aw-gr-h">Waiting for votes &amp; history</h3>
            {detail.rules
              .filter((r) => r.status === "OPEN")
              .map((r) => (
                <article className="aw-gw-proposal" key={r.id}>
                  <div>
                    <b>Rule change · {r.text}</b>
                    <small className="aw-gw-proposal-meta">
                      Proposed by {r.proposer} · {r.yes}/{detail.threshold} approved{r.no ? ` · ${r.no} no` : ""}
                    </small>
                  </div>
                  {detail.iSign && r.myVote === null ? (
                    <div className="aw-gw-actions">
                      <Button variant="outline" disabled={!!busy} onClick={() => run(`rn${r.id}`, () => send(`/api/groups/rules/${r.id}/vote`, "POST", { approve: false }), afterChange)}>
                        No
                      </Button>
                      <Button disabled={!!busy} onClick={() => run(`ry${r.id}`, () => send(`/api/groups/rules/${r.id}/vote`, "POST", { approve: true }), afterChange)}>
                        Approve
                      </Button>
                    </div>
                  ) : (
                    <small>{r.myVote !== null ? `You voted ${r.myVote ? "yes" : "no"}` : "Signers vote"}</small>
                  )}
                </article>
              ))}
            {detail.proposals.map((p) => (
              <article className="aw-gw-proposal" key={p.id}>
                <div>
                  <b>
                    {p.side === "PAYOUT"
                      ? `Payout · ${p.payout.map((r) => `${r.name} ${tokenMoney(r.amount, currency)}`).join(", ")} · ${tokenMoney(p.payout.reduce((t, r) => t + r.amount, 0), currency)}`
                      : p.side === "RELEASE"
                        ? p.title
                        : `${p.side === "SELL" ? "Sell" : "Pay"} · ${p.title} · ${tokenMoney(total(p.milestones), currency)}`}
                  </b>
                  <small className="aw-gw-proposal-meta">
                    Proposed by {p.mine ? "you" : p.proposer} · {p.yes}/{detail.threshold} approved{p.no ? ` · ${p.no} no` : ""} · {PROPOSAL_STATUS[p.status] ?? p.status}
                    {p.dealId !== null ? ` · deal D-${p.dealId}` : ""}
                  </small>
                  {p.voters.length > 0 && <small className="aw-gw-proposal-meta">{p.voters.map((v) => `${v.approve ? "✓" : "✗"} ${v.name}`).join(" · ")}</small>}
                </div>
                {p.status === "OPEN" && detail.iSign && p.myVote === null && (
                  <div className="aw-gw-actions">
                    <Button variant="outline" disabled={!!busy} onClick={() => run(`n${p.id}`, () => send(`/api/groups/proposals/${p.id}/vote`, "POST", { approve: false }), afterChange)}>
                      {busy === `n${p.id}` ? "…" : "No"}
                    </Button>
                    <Button disabled={!!busy} onClick={() => run(`y${p.id}`, () => send(`/api/groups/proposals/${p.id}/vote`, "POST", { approve: true }), afterChange)}>
                      {busy === `y${p.id}` ? "Locking…" : "Approve"}
                    </Button>
                  </div>
                )}
                {p.myVote !== null && p.status === "OPEN" && <small>You voted {p.myVote ? "yes" : "no"}</small>}
                {p.status === "FAILED" && detail.iSign && (
                  <Button disabled={!!busy} onClick={() => run(`x${p.id}`, () => send(`/api/groups/proposals/${p.id}/retry`, "POST"), afterChange)}>
                    {busy === `x${p.id}` ? "Executing…" : "Execute again"}
                  </Button>
                )}
                {p.mine && p.status === "OPEN" && (
                  <Button variant="outline" disabled={!!busy} onClick={() => run(`w${p.id}`, () => send(`/api/groups/proposals/${p.id}/withdraw`, "POST"), afterChange)}>
                    {busy === `w${p.id}` ? "…" : "Withdraw"}
                  </Button>
                )}
              </article>
            ))}
            <Card className="aw-group-panel">
              <h3>Recent</h3>
              <ul className="aw-gr-activity">
                {detail.activity.map((a, i) => (
                  <li key={i}>
                    <time>{new Date(a.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</time>
                    <span>{a.text}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <div className="aw-gw-actions">
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => {
                  if (!window.confirm(`Leave "${detail.name}"?`)) return;
                  void run("leave", () => send(`/api/groups/${detail.id}/leave`, "POST"), async () => {
                    setSelected(null);
                    await afterChange();
                  });
                }}
              >
                Leave group
              </Button>
              {detail.myRole === "ADMIN" && detail.company?.kind !== "COMPANY" && (
                <Button
                  variant="danger"
                  disabled={!!busy}
                  onClick={() => {
                    if (!window.confirm(`Dissolve "${detail.name}" for everyone? Open votes end; drafts stay with their proposers.${detail.company ? " The group wallet must be empty (pay it out first)." : ""}`)) return;
                    void run("delete", () => send(`/api/groups/${detail.id}`, "DELETE"), async () => {
                      setSelected(null);
                      await reload();
                    });
                  }}
                >
                  Dissolve group
                </Button>
              )}
            </div>
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
  months: {
    month: string;
    income: number;
    spent: number;
    refunds: number;
    dealIncome: number;
    transfersIn: number;
    dealSpent: number;
    transfersOut: number;
    topups: number;
    count: number;
  }[];
  deals: { title: string; spent: number; refunded: number }[];
  tax: { kind: string; year: number; income: number; taxable: number; tax: number; vatWarning: string | null; notes: string[] } | null;
};

export function LiveSummary() {
  const lang = useLang();
  const { wallet, drafts, me } = useAppData();
  // Keyed by the wallet being viewed, re-read every 30 s and whenever its balance moves.
  const { data, error, reload } = useApi<Summary>(`/api/summary?as=${me?.acting?.companyId ?? "me"}`, 30_000);
  const balanceKey = (me?.accounts ?? []).map((a) => a.balance).join(",");
  useEffect(() => {
    if (balanceKey) void reload();
  }, [balanceKey, reload]);
  const [hover, setHover] = useState<number | null>(null);
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
              ["Received", data?.totals.income, "Paid to you by deals and transfers", "green"],
              ["Spent", data?.totals.spent, "Locked into deals and sent to people", "red"],
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
          {data &&
            (() => {
              // Quick facts from the totals, like Napat's chips: month-on-month spending, failures, refunds.
              const ms = data.months;
              const [prev, cur] = [ms[ms.length - 2], ms[ms.length - 1]];
              const change = prev && cur && prev.spent > 0 ? Math.round(((cur.spent - prev.spent) / prev.spent) * 100) : null;
              const failed = drafts.filter((d) => d.status === "FAILED").length;
              const refunds = data.deals.filter((d) => d.refunded > 0).length;
              return (
                <div className="aw-summary-chips">
                  {change !== null && <span className={change > 0 ? "warn" : "ok"}>Spending {change > 0 ? "↑" : "↓"} {Math.abs(change)}% vs last month</span>}
                  <span className={failed ? "warn" : "ok"}>{failed ? `${failed} failed payment${failed > 1 ? "s" : ""} (refunded)` : "No failed payments"}</span>
                  <span className="info">
                    {refunds} refund{refunds === 1 ? "" : "s"}
                  </span>
                  <span className="info">{tokenMoney(locked, c)} still locked</span>
                </div>
              );
            })()}
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
          <div className="aw-summary-bars" onMouseLeave={() => setHover(null)}>
            {(data?.months ?? []).map((m, i) => {
              const label = new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString(lang === "th" ? "th-TH" : "en-US", { month: "short", year: "numeric", timeZone: "UTC" });
              const rows = (
                [
                  ["Paid to you by deals", m.dealIncome, "green"],
                  ["Sent to you", m.transfersIn, "green"],
                  ["Locked into deals", m.dealSpent, "red"],
                  ["You sent", m.transfersOut, "red"],
                  ["Refunded", m.refunds, "blue"],
                  ["Topped up", m.topups, "blue"],
                ] as const
              ).filter(([, v]) => v > 0);
              return (
                <div
                  className={`aw-summary-bar-group${hover === i ? " hover" : ""}`}
                  key={m.month}
                  tabIndex={0}
                  aria-label={`${label}: received ${tokenMoney(m.income, c)}, spent ${tokenMoney(m.spent, c)}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                >
                  {hover === i && (
                    <div className={`aw-summary-tip${i >= (data?.months.length ?? 0) - 2 ? " right" : ""}`} role="tooltip">
                      <b>{label}</b>
                      <p>
                        <span>Received</span>
                        <strong className="green">{tokenMoney(m.income, c)}</strong>
                      </p>
                      <p>
                        <span>Spent</span>
                        <strong className="red">{tokenMoney(m.spent, c)}</strong>
                      </p>
                      <p>
                        <span>Net</span>
                        <strong>{tokenMoney(m.income + m.refunds - m.spent, c)}</strong>
                      </p>
                      {rows.length > 0 && <hr />}
                      {rows.map(([k, v, tone]) => (
                        <p key={k} className="sub">
                          <span>{k}</span>
                          <strong className={tone}>{tokenMoney(v, c)}</strong>
                        </p>
                      ))}
                      <small>
                        {m.count} transaction{m.count === 1 ? "" : "s"}
                      </small>
                    </div>
                  )}
                  <div className="aw-summary-bars-pair">
                    <i style={{ height: `${m.income > 0 ? Math.max(2, Math.round((m.income / max) * 100)) : 0}%` }} />
                    <i style={{ height: `${m.spent > 0 ? Math.max(2, Math.round((m.spent / max) * 100)) : 0}%` }} />
                  </div>
                  <small>{label}</small>
                </div>
              );
            })}
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
  /** Who made the offer: while it is Proposed, only the other side can accept it. */
  offeredBy: "me" | "them";
  /** The other side has no account and this user invited them: their private link. */
  invite: { kind: "seller" | "buyer"; name: string; link: string | null; expiresAt: string; linked: boolean } | null;
  witnesses?: { side: string; name: string; contact: string; mine: boolean }[];
  /** This offer was withdrawn and replaced by an amended one. */
  replacedBy?: number | null;
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
  notes?: { kind: "CHANGES" | "REVISION"; index: number | null; text: string; at: string }[];
  milestones: {
    index: number;
    name: string;
    acceptance: string | null;
    amount: string;
    status: string;
    split?: { toSeller: string; toBuyer: string };
    deadline: number;
    moves: string[];
    delivers: "file" | "parcel" | "note";
    canPreview: boolean;
    canMockup?: boolean;
    deposit?: boolean;
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
          <span>Shipping receipt photo (optional · the buyer sees a watermarked preview)</span>
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label>
          <span>Note for the buyer (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} />
        </label>
        <p className="aw-gr-muted">Money is paid to you only after the buyer confirms the item arrived as agreed.</p>
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
function ParcelPanel({ p, shipTo, role, reviewing, onArrive }: { p: Parcel; shipTo: string | null; role: "buyer" | "seller"; reviewing: boolean; onArrive?: () => void }) {
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
      {shipTo && <p>Ship to: {role === "seller" ? <MaskedAddress text={shipTo} /> : shipTo}</p>}
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
      {p.tracked && !p.delivered && onArrive && (
        <button type="button" className="aw-parcel-test" onClick={onArrive}>
          ⚡ Deliver now (test mode)
        </button>
      )}
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

/** The agreed items of a parcel milestone, one per line of its acceptance criteria. */
const itemsOf = (acceptance: string | null) =>
  (acceptance ?? "")
    .split(/[\n;]|,(?![^(]*\))|\s\+\s/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .slice(0, 8);

/** An address with the house number and road partly hidden (PDPA), until the seller shows it. */
function MaskedAddress({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  const masked = text.replace(/\d+(\/\d+)?/, (n) => `${n[0]}${"•".repeat(Math.max(1, n.length - 1))}`).replace(/(Rd|Road|Soi|ถนน|ซอย)\s*([^,]+)/i, (_m, k) => `${k} •••`);
  return (
    <span className="aw-dd-address">
      {shown ? text : masked}{" "}
      <button type="button" onClick={() => setShown((v) => !v)}>
        {shown ? "Hide" : "Show full address"}
      </button>
      <small>Partly hidden on screen (PDPA). Only you, the seller, can see it.</small>
    </span>
  );
}

/** Buyer's request for changes to a delivery (off-chain; the review window keeps running). */
function NoteForm({ dealId, kind, index, deadline, onDone, onCancel }: { dealId: number; kind: "CHANGES" | "REVISION"; index?: number; deadline?: number; onDone: () => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="aw-deliver-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await send(`/api/deals/${dealId}/notes`, "POST", { kind, index, text });
          await onDone();
        } catch (e2) {
          setErr((e2 as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        <span>{kind === "CHANGES" ? "What should the seller change?" : "What should the seller change in the offer?"}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder={kind === "CHANGES" ? "e.g. Add the top-risks section and export as PDF" : "e.g. Split it into 2 milestones, ฿2,500 each"} />
      </label>
      {kind === "CHANGES" && deadline ? (
        <small>Your review window still ends {when(deadline)}: if the fix does not arrive by then, dispute before it ends.</small>
      ) : null}
      {kind === "REVISION" && <small>The seller sees your note, withdraws this offer and sends a new one. Nothing is paid until you accept.</small>}
      <div className="aw-actions">
        <Button type="submit" disabled={busy || text.trim().length < 5}>
          {busy ? "Sending…" : kind === "CHANGES" ? "Send request" : "Ask for a revision"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {err && <p className="aw-bank-error">{err}</p>}
    </form>
  );
}

/** The private link for the other side of the deal (made when the deal was confirmed). */
function InviteLinkCard({ dealId, invite, onDone }: { dealId: number; invite: NonNullable<DealDetail["invite"]>; onDone: () => Promise<void> }) {
  const [link, setLink] = useState<string | null>(invite.link);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = link ?? invite.link;
  return (
    <section className="aw-invite-link-card">
      <div>
        <b>
          {invite.kind === "seller" ? "Seller link" : "Buyer link"} for {invite.name}
        </b>
        <small>
          {invite.linked
            ? "They opened it signed in: the deal is linked to their account."
            : invite.kind === "seller"
              ? "No account needed: they accept, deliver and get paid on this page. Send it to them privately."
              : "No account needed: they pay by card and approve the delivery on this page. Send it to them privately."}{" "}
          Works until {new Date(invite.expiresAt).toLocaleDateString()}.
        </small>
      </div>
      {shown ? (
        <div className="aw-invite-link-row">
          <input readOnly value={shown} onFocus={(e) => e.currentTarget.select()} aria-label="Private link" />
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(shown);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : (
        <small>This link was made before links were kept here: make a new one below.</small>
      )}
      <button
        type="button"
        className="aw-invite-link-new"
        disabled={busy}
        onClick={async () => {
          if (shown && !window.confirm("Make a new link? The old one stops working.")) return;
          setBusy(true);
          setErr(null);
          try {
            setLink((await send<{ link: string }>(`/api/deals/${dealId}/invite-link`, "POST")).link);
            await onDone();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "…" : shown ? "Make a new link (the old one stops working)" : "Make a new link"}
      </button>
      {err && <p className="aw-bank-error">{err}</p>}
    </section>
  );
}

export function LiveDealDetail({ dealId, go }: { dealId: string; go: (screen: string) => void }) {
  const [templateMsg, setTemplateMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [templateFrom, setTemplateFrom] = useState<TemplatePayload | null>(null);
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
  const [asking, setAsking] = useState<number | "offer" | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [evidence, setEvidence] = useState(false);
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
          <div className="aw-d012-head-actions">
            <Button
              variant="outline"
              disabled={!data}
              onClick={() =>
                data &&
                setTemplateFrom({
                  name: data.title,
                  side: data.role === "buyer" ? "BUY" : "SELL",
                  kind: data.kind,
                  title: data.title,
                  summary: data.summary ?? "",
                  milestones: data.milestones.map((m) => ({ name: m.name, amount: String(Number(m.amount)), delivery: m.delivers, acceptance: m.acceptance ?? "", dueDays: null })),
                })
              }
            >
              ☆ Save as template
            </Button>
            <Button variant="outline" onClick={() => go("ดีลทั้งหมด")}>
              ← All deals
            </Button>
          </div>
        </header>
        {templateMsg && <p className={templateMsg.ok ? "aw-live-ok" : "aw-bank-error"}>{templateMsg.text}</p>}
        {templateFrom && <SaveTemplateDialog payload={templateFrom} currency={c} onClose={() => setTemplateFrom(null)} onSaved={(text) => setTemplateMsg({ ok: true, text })} />}
        {data?.invite && <InviteLinkCard dealId={id} invite={data.invite} onDone={reload} />}
        {error && <p className="aw-bank-error">{error}</p>}
        {!data && !error && <Loading block text="Reading the deal from the chain…" />}
        {note}
        {data &&
          (() => {
            const ms = data.milestones;
            const paid = ms.reduce((t, m) => t + (m.status === "Released" ? Number(m.amount) : m.split ? Number(m.split.toSeller) : 0), 0);
            const back = ms.reduce((t, m) => t + (m.status === "Refunded" ? Number(m.amount) : m.split ? Number(m.split.toBuyer) : 0), 0);
            const locked = data.status === "Active" || (data.status === "Proposed" && data.role === "buyer" && data.canCancel) ? Number(data.total) - paid - back : 0;
            const open = ms.filter((m) => ["Delivered", "Approved", "KeyReleased"].includes(m.status) && m.deadline > 0).sort((a, b) => a.deadline - b.deadline)[0];
            const next = open
              ? {
                  label: open.status === "Delivered" ? (data.role === "buyer" ? "Your review ends" : "Buyer's review ends") : open.status === "Approved" ? "Key due by" : "Paid automatically after",
                  value: when(open.deadline),
                  hint: open.status === "Delivered" ? (data.role === "buyer" ? "Silence lets the seller be paid" : "Then you can be paid") : "No action needed",
                }
              : { label: "Next step", value: data.status === "Proposed" ? "Waiting for acceptance" : ms.every((m) => ["Released", "Refunded", "Split"].includes(m.status)) ? "Done" : "Waiting for delivery", hint: "" };
            return (
              <div className="aw-dd-stats">
                <div>
                  <small>Total</small>
                  <b>{tokenMoney(data.total, c)}</b>
                  <small>{ms.length} milestone{ms.length === 1 ? "" : "s"}</small>
                </div>
                <div>
                  <small>Locked now</small>
                  <b className="amber">{tokenMoney(locked, c)}</b>
                  <small>{locked > 0 ? "In escrow · nobody can move it alone" : "Nothing locked"}</small>
                </div>
                <div>
                  <small>{data.role === "seller" ? "Paid to you" : "Paid to the seller"}</small>
                  <b className="green">{tokenMoney(paid, c)}</b>
                  <small>{back > 0 ? `${tokenMoney(back, c)} returned to the buyer` : data.role === "seller" ? `Into your ${me?.acting ? "company " : ""}wallet ${me?.accounts[0]?.accountNo ?? ""}` : "After you approve each delivery"}</small>
                </div>
                <div>
                  <small>{next.label}</small>
                  <b className="blue">{next.value}</b>
                  <small>{next.hint}</small>
                </div>
              </div>
            );
          })()}
        {data?.replacedBy != null && (
          <p className="aw-dd-note">
            ✎ This offer was changed: it was withdrawn and replaced by <a href={`/deals/D-${data.replacedBy}`}>D-{data.replacedBy}</a> (same person, same link).
          </p>
        )}
        {data?.summary && <p>{data.summary}</p>}
        {data && data.status !== "Cancelled" && (
          <div className="aw-deal-paper">
            <DealDocuments dealId={id} milestones={data.milestones} />
            <WitnessPanel dealId={id} role={data.role} witnesses={data.witnesses ?? []} onDone={reload} />
          </div>
        )}
        {data?.notes
          ?.filter((n) => n.kind === "REVISION")
          .map((n, i) => (
            <p className="aw-dd-note" key={i}>
              ✎ {data.role === "seller" ? "The buyer asks for a revised offer" : "You asked for a revised offer"}: “{n.text}”
            </p>
          ))}
        <div className="aw-d012-columns">
          {data?.milestones.map((m) => (
            <section className="aw-d012-card" key={m.index}>
              <h2>
                {m.index + 1}. {m.name}
                {m.deposit && <span className="aw-deposit-tag">💰 Deposit · paid on signing</span>}
              </h2>
              <div className="aw-d012-payout">
                <span>
                  {data.status === "Proposed"
                    ? data.offeredBy === "me"
                      ? `Starts when ${data.counterpartyLabel} accepts${data.role === "seller" ? " and pays" : ""}`
                      : "Starts when you accept"
                    : ((data.role === "seller" ? SELLER_STEP : STEP)[m.status] ?? m.status)}
                </span>
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
                  {m.canMockup && <SiteMockup src={`/api/deals/${id}/site/${m.index}`} name={m.delivery.fileName ?? "website"} />}
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
              {m.delivery?.parcel && (
                <ParcelPanel
                  p={m.delivery.parcel}
                  shipTo={data.shipTo}
                  role={data.role}
                  reviewing={m.status === "Delivered"}
                  onArrive={() => void run(`parcel${m.index}`, () => send(`/api/deals/${id}/parcel`, "POST", { index: m.index }), after)}
                />
              )}
              {!m.delivery?.parcel && m.delivers === "parcel" && data.shipTo && data.role === "seller" && (
                <p>
                  📦 Ship to: <MaskedAddress text={data.shipTo} />
                </p>
              )}
              {data.notes
                ?.filter((n) => n.kind === "CHANGES" && n.index === m.index)
                .map((n, i) => (
                  <p className="aw-dd-note" key={i}>
                    ✎ {data.role === "seller" ? "The buyer asks for changes" : "You asked for changes"} ({new Date(n.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}): “{n.text}”
                    {data.role === "seller" && m.moves.includes("deliver") ? " · deliver the fixed version below" : ""}
                  </p>
                ))}
              {asking === m.index && (
                <NoteForm
                  dealId={id}
                  kind="CHANGES"
                  index={m.index}
                  deadline={m.deadline}
                  onCancel={() => setAsking(null)}
                  onDone={async () => {
                    setAsking(null);
                    await after();
                  }}
                />
              )}
              {data.role === "buyer" && m.delivers === "parcel" && m.status === "Delivered" && itemsOf(m.acceptance).length > 0 && (
                <fieldset className="aw-dd-items">
                  <legend>Open the box and tick each agreed item before you pay</legend>
                  {itemsOf(m.acceptance).map((it, k) => (
                    <label key={k}>
                      <input type="checkbox" checked={Boolean(checked[`${m.index}:${k}`])} onChange={(e) => setChecked((c2) => ({ ...c2, [`${m.index}:${k}`]: e.target.checked }))} />
                      {it}
                    </label>
                  ))}
                  <small>There is no automatic confirmation from you: report a problem (dispute) if anything is missing or damaged.</small>
                </fieldset>
              )}
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
                    <Button
                      disabled={
                        !!busy ||
                        (data.role === "buyer" && m.delivers === "parcel" && m.status === "Delivered" && itemsOf(m.acceptance).some((_, k) => !checked[`${m.index}:${k}`]))
                      }
                      onClick={() => act("approve", m.index)}
                    >
                      {busy === `approve${m.index}` ? "…" : m.delivers === "parcel" ? "I received it · pay the seller" : data.kind === "GOODS" ? "Approve & unlock file" : "Approve work"}
                    </Button>
                  )}
                  {data.role === "buyer" && m.status === "Delivered" && m.delivers !== "parcel" && asking !== m.index && (
                    <Button variant="outline" disabled={!!busy} onClick={() => setAsking(m.index)}>
                      Request changes
                    </Button>
                  )}
                  {m.moves.includes("dispute") && disputing !== m.index && (
                    <Button variant="outline" disabled={!!busy} onClick={() => setDisputing(m.index)}>
                      {m.delivers === "parcel" ? "Report a problem" : "Dispute"}
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
            {data.role === "buyer" && asking !== "offer" && (
              <Button variant="outline" disabled={!!busy} onClick={() => setAsking("offer")}>
                Request revision
              </Button>
            )}
          </div>
        )}
        {asking === "offer" && (
          <NoteForm
            dealId={id}
            kind="REVISION"
            onCancel={() => setAsking(null)}
            onDone={async () => {
              setAsking(null);
              await after();
            }}
          />
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
        {data && (
          <section className="aw-dd-evidence">
            <button type="button" onClick={() => setEvidence((v) => !v)} aria-expanded={evidence}>
              ♧ Evidence (for audit) {evidence ? "▴" : "▾"}
            </button>
            {evidence && (
              <ul>
                <li>Deal D-{data.id} · {data.status} · escrow {data.escrow ? <a href={data.escrow} target="_blank" rel="noreferrer">contract ↗</a> : "—"}</li>
                {data.milestones.map((m) => (
                  <li key={m.index}>
                    Milestone {m.index + 1} · {m.status}
                    {m.delivery ? ` · work hash sha256 ${m.delivery.sha256.slice(0, 16)}… (anchored on-chain at delivery)` : " · not delivered yet"}
                    {m.dispute?.txHash ? (
                      <>
                        {" · ruling "}
                        <a href={`/explorer/tx/${m.dispute.txHash}`} target="_blank" rel="noreferrer">
                          tx ↗
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
                <li>Only hashes and amounts are on-chain; terms, notes and files stay off-chain and can be deleted (PDPA).</li>
              </ul>
            )}
          </section>
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
