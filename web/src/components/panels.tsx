"use client";

import { useState } from "react";

import type { ActionResult } from "@/lib/actions";
import type { Sample } from "@/lib/samples";
import type { MilestoneStatus } from "@/lib/state";

import { Outcome, TxLink, type Workspace, fmt, postAction, short } from "./ui";

type Run = (label: string, body: Record<string, unknown>) => Promise<void>;

export function useActions(address: string, onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<{ label: string; result?: ActionResult; error?: string } | null>(null);
  const run: Run = async (label, body) => {
    setBusy(label);
    try {
      const result = await postAction(address, body);
      setLast({ label, result });
    } catch (e) {
      setLast({ label, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
      onChanged();
    }
  };
  return { busy, last, run, clear: () => setLast(null) };
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function WalletPanel({ ws, run, busy }: { ws: Workspace; run: Run; busy: string | null }) {
  const used = Number(ws.session.dailyLimit) - Number(ws.session.remainingToday);
  const pct = Math.min(100, (used / Number(ws.session.dailyLimit)) * 100);
  return (
    <Section
      title="Wallet"
      right={
        ws.paused ? (
          <span className="pill bg-bad-soft text-bad">● Paused</span>
        ) : (
          <span className="pill bg-ok-soft text-ok">● Active</span>
        )
      }
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold tabular-nums">{fmt(ws.balance)}</div>
          <div className="text-xs text-muted">mUSDC available · {ws.chain}</div>
        </div>
        {ws.explorer ? (
          <a className="font-mono text-xs text-accent hover:underline" href={ws.explorer} target="_blank" rel="noreferrer">
            {short(ws.address)} ↗
          </a>
        ) : (
          <span className="font-mono text-xs text-muted">{short(ws.address)}</span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-surface-2 p-3">
          <div className="text-xs text-muted">Agent per-tx cap</div>
          <div className="font-medium tabular-nums">{fmt(ws.session.maxPerTx)}</div>
        </div>
        <div className="rounded-lg bg-surface-2 p-3">
          <div className="text-xs text-muted">Approvals required</div>
          <div className="font-medium">
            {ws.threshold} of {ws.approvers.filter((a) => a.active).length}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>Agent daily allowance used</span>
          <span className="tabular-nums">
            {fmt(used)} / {fmt(ws.session.dailyLimit)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-muted">
          Agent session key {short(ws.session.agent)}{" "}
          {ws.session.active ? (
            <span className="text-ok">valid until {new Date(ws.session.expiresAt * 1000).toLocaleDateString("en-GB")}</span>
          ) : (
            <span className="text-bad">revoked</span>
          )}
        </span>
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Tier 3 · Emergency controls</div>
        <div className="flex flex-wrap gap-2">
          {ws.paused ? (
            <button className="btn-ghost" disabled={!!busy} onClick={() => run("Unpause (owner)", { type: "unpause" })}>
              Unpause (owner)
            </button>
          ) : (
            <button className="btn-danger" disabled={!!busy} onClick={() => run("Kill switch", { type: "pause", role: "owner" })}>
              ⏻ Kill switch
            </button>
          )}
          {ws.session.active ? (
            <button className="btn-ghost" disabled={!!busy} onClick={() => run("Revoke agent key", { type: "revoke_session" })}>
              Revoke agent key
            </button>
          ) : (
            <button className="btn-ghost" disabled={!!busy} onClick={() => run("Restore agent key", { type: "restore_session" })}>
              Restore agent key
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-bad/30 bg-bad-soft/50 p-3">
        <div className="text-sm font-medium text-bad">Attack test: bypass the AI and the policy engine</div>
        <p className="mt-1 text-xs text-muted">
          Signs <code className="font-mono">agentTransfer(0xBad…, 5000)</code> with the agent&apos;s own key and forces it
          on-chain. Only the contract stands in the way.
        </p>
        <button className="btn-danger mt-2" disabled={!!busy} onClick={() => run("Raw attack", { type: "raw_attack" })}>
          Send malicious transaction
        </button>
      </div>
    </Section>
  );
}

export function ApprovalsPanel({ ws, run, busy }: { ws: Workspace; run: Run; busy: string | null }) {
  const open = ws.proposals.filter((p) => p.status === "open");
  const closed = ws.proposals.filter((p) => p.status !== "open").slice(0, 4);
  return (
    <Section title="Approvals (Tier 1)" right={<span className="pill bg-warn-soft text-warn">{open.length} waiting</span>}>
      {open.length === 0 && <p className="text-sm text-muted">Nothing waiting. Large or new payments the agent proposes show up here.</p>}
      <div className="flex flex-col gap-3">
        {open.map((p) => (
          <div key={p.id} className="rounded-lg border border-warn/30 bg-warn-soft/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{p.summary}</div>
                <div className="mt-0.5 text-xs text-muted">
                  #{p.id} · proposed by {p.proposer} · {p.approvals}/{ws.threshold} approvals
                </div>
              </div>
            </div>
            {p.reason && <p className="mt-2 rounded bg-surface px-2 py-1.5 text-xs text-muted">“{p.reason}”</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {(["approverA", "approverB"] as const).map((role) => {
                const done = p.approvedBy.includes(role);
                const label = role === "approverA" ? "Approver A" : "Approver B";
                return (
                  <button
                    key={role}
                    className={done ? "btn-ghost" : "btn-primary"}
                    disabled={done || !!busy || ws.paused}
                    onClick={() => run(`Approve #${p.id} as ${label}`, { type: "approve", id: p.id, role })}
                  >
                    {done ? `✓ ${label}` : `Approve as ${label}`}
                  </button>
                );
              })}
              <button className="btn-ghost" disabled={!!busy} onClick={() => run(`Reject #${p.id}`, { type: "cancel", id: p.id })}>
                Reject
              </button>
            </div>
          </div>
        ))}
        {closed.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            {closed.map((p) => (
              <div key={p.id} className="flex justify-between gap-2 text-xs text-muted">
                <span className="truncate">
                  #{p.id} {p.summary}
                </span>
                <span className={p.status === "executed" ? "text-ok" : ""}>{p.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

const STATUS_TONE: Record<MilestoneStatus, string> = {
  Pending: "bg-surface-2 text-muted",
  EvidenceSubmitted: "bg-info-soft text-info",
  Released: "bg-ok-soft text-ok",
  Disputed: "bg-warn-soft text-warn",
  Refunded: "bg-bad-soft text-bad",
};

export function DealsPanel({
  ws,
  samples,
  run,
  busy,
}: {
  ws: Workspace;
  samples: Sample[];
  run: Run;
  busy: string | null;
}) {
  const evidence = samples.filter((s) => s.who === "contractor");
  return (
    <Section title="Deals & milestones">
      {ws.deals.length === 0 && (
        <p className="text-sm text-muted">No deals yet. Send the purchase order to the agent, then approve the proposal.</p>
      )}
      <div className="flex flex-col gap-4">
        {ws.deals.map((d) => (
          <div key={d.id}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <div>
                <div className="text-sm font-medium">
                  {d.terms?.po ?? `Deal #${d.id}`} · {d.terms?.title}
                </div>
                <div className="text-xs text-muted">
                  Deal #{d.id} · {fmt(d.total)} mUSDC to {d.payeeLabel} · {d.funded ? "funded" : "not funded"}
                </div>
              </div>
            </div>
            <ol className="flex flex-col gap-2">
              {d.milestones.map((m) => {
                const sample = evidence.find((s) => s.milestoneIndex === m.index);
                const canSubmit = d.funded && (m.status === "Pending" || m.status === "EvidenceSubmitted");
                return (
                  <li key={m.index} className="rounded-lg border border-border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm">
                          {m.index + 1}. {m.name}
                        </div>
                        <div className="text-xs text-muted">
                          {fmt(m.amount)} mUSDC{m.due ? ` · due ${m.due}` : ""}
                        </div>
                      </div>
                      <span className={`pill ${STATUS_TONE[m.status]}`}>
                        {m.status === "EvidenceSubmitted" ? "Evidence in" : m.status}
                      </span>
                    </div>
                    {m.evidence && (
                      <details className="mt-1.5 text-xs">
                        <summary className="cursor-pointer text-muted">
                          Evidence: {m.evidence.title} · hash {m.evidenceHash ? short(m.evidenceHash) : ""}
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] whitespace-pre-wrap">
                          {m.evidence.text}
                        </pre>
                      </details>
                    )}
                    {canSubmit && sample && (
                      <button
                        className="btn-ghost mt-2 text-xs"
                        disabled={!!busy}
                        onClick={() =>
                          run(`Contractor submits ${sample.title}`, {
                            type: "submit_evidence",
                            dealId: d.id,
                            index: m.index,
                            title: sample.title,
                            text: sample.text,
                          })
                        }
                      >
                        As contractor: submit “{sample.title}”
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function AuditPanel({ ws }: { ws: Workspace }) {
  return (
    <Section title="On-chain audit log" right={<span className="text-xs text-muted">{ws.audit.length} events</span>}>
      {ws.audit.length === 0 && <p className="text-sm text-muted">Every agent and human action lands here as a contract event.</p>}
      <ol className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
        {ws.audit.map((e, i) => (
          <li key={`${e.txHash}-${i}`} className="rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{e.event}</span>
              <TxLink hash={e.txHash} url={e.url} />
            </div>
            <div className="truncate text-muted" title={e.detail}>
              {e.detail}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function LastAction({
  last,
  busy,
  clear,
}: {
  last: { label: string; result?: ActionResult; error?: string } | null;
  busy: string | null;
  clear: () => void;
}) {
  if (busy) {
    return (
      <div className="card flex items-center gap-2 border-accent/40 px-4 py-3 text-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> {busy}: signing and waiting for confirmation…
      </div>
    );
  }
  if (!last) return null;
  return (
    <div className="card flex items-start justify-between gap-3 px-4 py-3">
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{last.label}</span>
        {last.error ? <span className="text-bad">{last.error}</span> : last.result && <Outcome result={last.result} />}
      </div>
      <button className="text-xs text-muted hover:text-fg" onClick={clear}>
        dismiss
      </button>
    </div>
  );
}
