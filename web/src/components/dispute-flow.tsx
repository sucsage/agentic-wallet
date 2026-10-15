"use client";

import { useState } from "react";

import "./dispute-flow.css";

/**
 * A work dispute on FileEscrow v2, as both parties see it (Napat's v0.8 layout):
 *   Step 1 · AI mediator proposes a split → both accept, or either rejects
 *   Step 2 · AI panel · 3 models from different providers, 2 of 3 agree → accept or appeal
 *   Step 3 · Appeal · 5 models, 3 of 5 agree → final
 * then where the money went. Used on the deal page and on an invited seller's link.
 */

export type DisputeVote = {
  model: string;
  sellerBps?: number;
  rationale?: string;
  findings?: { criterion: string; met: boolean; evidence: string }[];
  signer?: string;
  signature?: string;
  failed?: true;
};

export type DisputeFlowData = {
  phase: "work" | "key";
  stage: string;
  reason: string;
  sellerStatement: string | null;
  status: "OPEN" | "DECIDING" | "AWAITING" | "NEEDS_REVIEW" | "RESOLVED";
  decision: string | null;
  rationale: string | null;
  decidedBy: string | null;
  txHash: string | null;
  proposal: DisputeVote | null;
  buyerReply: string | null;
  sellerReply: string | null;
  replyBy: string | null;
  panel: DisputeVote[] | null;
  panelBps: number | null;
  appealedBy: string | null;
  appeal: DisputeVote[] | null;
  appealBps: number | null;
  sellerBps: number | null;
};

export type DisputeReply = "ACCEPT" | "REJECT" | "APPEAL";

const STAGES = ["MEDIATION", "PANEL", "APPEAL"];
export const isStagedDispute = (d: { stage?: string } | null | undefined) => Boolean(d?.stage && STAGES.includes(d.stage));

const modelName = (m: string) => m.split("/").pop() ?? m;
const pct = (bps: number) => `${Math.round(bps / 100)}%`;
const until = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export function DisputeFlow({
  d,
  role,
  amount,
  money,
  explorerTx,
  onReply,
}: {
  d: DisputeFlowData;
  /** Who is looking: their own side is "You". */
  role: "buyer" | "seller";
  /** The milestone amount (token units, e.g. "1600.00"). */
  amount: string;
  money: (n: number) => string;
  /** Link to a transaction in the explorer, when there is one. */
  explorerTx?: (hash: string) => string;
  onReply: (reply: DisputeReply, statement?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<DisputeReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const total = Number(amount);
  const sellerOf = (bps: number) => (total * bps) / 10_000;
  const me = role === "buyer" ? "You" : "Seller (you)";
  const other = role === "buyer" ? "Seller" : "Buyer";
  const mine = role === "buyer" ? d.buyerReply : d.sellerReply;
  const theirs = role === "buyer" ? d.sellerReply : d.buyerReply;
  const deciding = d.status === "OPEN" || d.status === "DECIDING";

  async function reply(r: DisputeReply) {
    setBusy(r);
    setError(null);
    try {
      await onReply(r, role === "seller" && statement.trim() ? statement.trim() : undefined);
      setStatement("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** "Buyer 70% · Seller 30%" with amounts, from the reader's side. */
  const split = (bps: number) => (
    <div className="dsp-split">
      <div>
        <small>{role === "buyer" ? "Back to you" : "Back to the buyer"}</small>
        <b className="buyer">
          {pct(10_000 - bps)} · {money(total - sellerOf(bps))}
        </b>
      </div>
      <div>
        <small>{role === "seller" ? "Paid to you" : "Paid to the seller"}</small>
        <b className="seller">
          {pct(bps)} · {money(sellerOf(bps))}
        </b>
      </div>
    </div>
  );

  const voteList = (votes: DisputeVote[], verdict: number | null) => (
    <ul className="dsp-votes">
      {votes.map((v, i) => {
        const agrees = verdict !== null && v.sellerBps !== undefined && Math.abs(v.sellerBps - verdict) <= 1000;
        return (
          <li key={i} className={v.failed ? "failed" : agrees ? "agree" : "differ"}>
            <span>
              <b>{modelName(v.model)}</b>
              {v.signer && v.signature && (
                <small title={`signed by ${v.signer}: ${v.signature}`}>
                  signed {v.signature.slice(0, 6)}…{v.signature.slice(-4)}
                </small>
              )}
            </span>
            <span>{v.failed ? "no valid ruling" : `${role === "buyer" ? "You" : "Buyer"} ${pct(10_000 - (v.sellerBps ?? 0))} · seller ${pct(v.sellerBps ?? 0)}`}</span>
            {v.rationale && <p>{v.rationale}</p>}
          </li>
        );
      })}
    </ul>
  );

  const stageIndex = STAGES.indexOf(d.stage);
  const resolved = d.status === "RESOLVED";

  return (
    <div className="dsp">
      <header className="dsp-head">
        <small>⚖ DISPUTE · AI DECIDES INSTEAD OF A PERSON</small>
        <span className={`dsp-pill ${resolved ? "ok" : d.status === "NEEDS_REVIEW" ? "warn" : "live"}`}>
          {resolved ? "Resolved" : d.status === "NEEDS_REVIEW" ? "With a human arbiter" : "In progress"}
        </span>
      </header>
      <div className="dsp-sides">
        <p>
          <b>{role === "buyer" ? "You" : "Buyer"}:</b> {d.reason}
        </p>
        {d.sellerStatement && (
          <p>
            <b>{role === "seller" ? "You" : "Seller"}:</b> {d.sellerStatement}
          </p>
        )}
      </div>

      {/* Step 1 · mediator */}
      <section className={`dsp-step${stageIndex > 0 || (resolved && d.stage === "MEDIATION") ? " done" : ""}`}>
        <h3>Step 1 · AI mediator</h3>
        {!d.proposal && deciding && d.stage === "MEDIATION" && <p className="dsp-wait">The mediator is reading the terms, the delivery and both sides…</p>}
        {d.proposal && !d.proposal.failed && d.proposal.sellerBps !== undefined && (
          <>
            <p>
              {modelName(d.proposal.model)} proposes: <b>{d.proposal.rationale}</b>
            </p>
            {split(d.proposal.sellerBps)}
            {d.stage === "MEDIATION" ? (
              <p className="dsp-replies">
                {me}: {replyText(mine)} · {other}: {replyText(theirs)}
              </p>
            ) : (
              <p className="dsp-replies">Not accepted by both sides → sent to the AI panel.</p>
            )}
          </>
        )}
        {d.stage === "MEDIATION" && d.status === "AWAITING" && (
          <>
            {role === "seller" && !mine && (
              <textarea className="dsp-input" maxLength={2000} placeholder="Your side, for the AI panel if this goes further (optional)" value={statement} onChange={(e) => setStatement(e.target.value)} />
            )}
            {!mine && (
              <div className="dsp-actions">
                <button type="button" className="dsp-btn" disabled={busy !== null} onClick={() => reply("ACCEPT")}>
                  {busy === "ACCEPT" ? "Accepting…" : "Accept proposal"}
                </button>
                <button type="button" className="dsp-btn outline" disabled={busy !== null} onClick={() => reply("REJECT")}>
                  {busy === "REJECT" ? "Sending to the panel…" : "Reject → AI panel"}
                </button>
              </div>
            )}
            <small className="dsp-note">
              If both accept, it is paid out at once. No answer by {until(d.replyBy)} sends the case to the AI panel.
            </small>
          </>
        )}
      </section>

      {/* Step 2 · panel */}
      {stageIndex >= 1 && (
        <section className={`dsp-step${stageIndex > 1 || (resolved && d.stage === "PANEL") ? " done" : ""}`}>
          <h3>Step 2 · AI panel · 3 models</h3>
          <small className="dsp-note">Each model is from a different provider and signs its ruling with its own key. At least 2 of 3 must agree.</small>
          {!d.panel && deciding && <p className="dsp-wait">Three models are ruling independently…</p>}
          {d.panel && voteList(d.panel, d.panelBps)}
          {d.panelBps !== null && (
            <>
              <p className="dsp-verdict">
                Verdict: {role === "buyer" ? "You" : "Buyer"} {pct(10_000 - d.panelBps)} · seller {pct(d.panelBps)} <span>2 of 3 agree</span>
              </p>
              {split(d.panelBps)}
            </>
          )}
          {d.stage === "PANEL" && d.status === "AWAITING" && (
            <>
              <p className="dsp-replies">
                {me}: {replyText(mine)} · {other}: {replyText(theirs)}
              </p>
              {!mine && (
                <div className="dsp-actions">
                  <button type="button" className="dsp-btn" disabled={busy !== null} onClick={() => reply("ACCEPT")}>
                    {busy === "ACCEPT" ? "Accepting…" : "Accept verdict"}
                  </button>
                  <button type="button" className="dsp-btn outline" disabled={busy !== null} onClick={() => reply("APPEAL")}>
                    {busy === "APPEAL" ? "Appealing…" : "Appeal · 5 models"}
                  </button>
                </div>
              )}
              <small className="dsp-note">No appeal by {until(d.replyBy)} → the verdict is paid out as above.</small>
            </>
          )}
        </section>
      )}

      {/* Step 3 · appeal */}
      {stageIndex >= 2 && (
        <section className={`dsp-step${resolved ? " done" : ""}`}>
          <h3>Appeal · 5 models</h3>
          <small className="dsp-note">
            Appealed by {d.appealedBy === role ? "you" : `the ${d.appealedBy}`}. Five models, 3 of 5 must agree. This ruling is final.
          </small>
          {!d.appeal && deciding && <p className="dsp-wait">Five independent models are reviewing the case…</p>}
          {d.appeal && voteList(d.appeal, d.appealBps)}
          {d.appealBps !== null && (
            <p className="dsp-verdict">
              Final: {role === "buyer" ? "You" : "Buyer"} {pct(10_000 - d.appealBps)} · seller {pct(d.appealBps)} <span>3 of 5 agree</span>
            </p>
          )}
        </section>
      )}

      {d.status === "NEEDS_REVIEW" && <p className="dsp-wait">{d.rationale ?? "The models did not agree."} A human arbiter decides; the money stays locked until then.</p>}

      {resolved && d.sellerBps !== null && (
        <section className="dsp-step done">
          <h3>Where the money went</h3>
          {split(d.sellerBps)}
          <small className="dsp-note">
            {d.decidedBy?.startsWith("mediation") ? "Both sides accepted the mediator." : d.decidedBy === "human arbiter" ? "Decided by a human arbiter." : d.decidedBy?.startsWith("appeal") ? "Decided on appeal (3 of 5)." : "Decided by the AI panel (2 of 3)."}
            {d.txHash && explorerTx && (
              <>
                {" · "}
                <a href={explorerTx(d.txHash)} target="_blank" rel="noreferrer">
                  settlement tx ↗
                </a>
              </>
            )}
          </small>
        </section>
      )}
      {error && <p className="dsp-error">{error}</p>}
    </div>
  );
}

function replyText(r: string | null) {
  return r === "ACCEPT" ? "accepted ✓" : r === "REJECT" ? "rejected" : r === "APPEAL" ? "appealed" : "waiting";
}
