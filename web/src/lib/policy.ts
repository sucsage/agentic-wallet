import "server-only";

import type { DealView, MilestoneView, WalletState } from "./state";

/**
 * Guard #1: the off-chain policy engine. It decides which permission tier an agent action falls
 * into before anything is signed. Guard #2 is the AgentWallet contract, which enforces the same
 * caps and allowlists again on-chain, so a bug or bypass here still cannot move funds.
 */
export type Decision =
  | { route: "execute"; tier: 2; reasons: string[] }
  | { route: "propose"; tier: 1; reasons: string[] }
  | { route: "block"; tier: 3 | 1; reasons: string[] };

const n = (s: string) => Number(s);

function isAllowlisted(state: WalletState, address: string) {
  return state.allowlist.recipients.some((r) => r.address.toLowerCase() === address.toLowerCase());
}

function capCheck(state: WalletState, amount: number): string[] {
  const reasons: string[] = [];
  if (amount > n(state.session.maxPerTx)) {
    reasons.push(`${amount} mUSDC exceeds the per-transaction cap of ${state.session.maxPerTx}`);
  }
  if (amount > n(state.session.remainingToday)) {
    reasons.push(`${amount} mUSDC exceeds today's remaining limit of ${state.session.remainingToday}`);
  }
  return reasons;
}

export function evaluateTransfer(state: WalletState, to: string, amount: number): Decision {
  if (state.paused) return { route: "block", tier: 3, reasons: ["Wallet is paused (emergency stop)"] };
  if (!state.session.active) return { route: "block", tier: 3, reasons: ["Agent session key is revoked or expired"] };
  if (!isAllowlisted(state, to)) {
    return {
      route: "block",
      tier: 1,
      reasons: [`${to} is not an allowlisted recipient. Only the owner can add recipients.`],
    };
  }
  if (!(amount > 0)) return { route: "block", tier: 1, reasons: ["Amount must be positive"] };
  const caps = capCheck(state, amount);
  if (caps.length) return { route: "propose", tier: 1, reasons: caps };
  return { route: "execute", tier: 2, reasons: ["Allowlisted recipient, within per-tx and daily caps"] };
}

export function evaluateRelease(
  state: WalletState,
  deal: DealView | undefined,
  milestone: MilestoneView | undefined,
): Decision {
  if (state.paused) return { route: "block", tier: 3, reasons: ["Wallet is paused (emergency stop)"] };
  if (!state.session.active) return { route: "block", tier: 3, reasons: ["Agent session key is revoked or expired"] };
  if (!deal || !milestone) return { route: "block", tier: 1, reasons: ["Unknown deal or milestone"] };
  if (!deal.funded) return { route: "block", tier: 1, reasons: ["Deal is not funded yet"] };
  if (milestone.status !== "Pending" && milestone.status !== "EvidenceSubmitted") {
    return { route: "block", tier: 1, reasons: [`Milestone is already ${milestone.status}`] };
  }
  if (!isAllowlisted(state, deal.payee)) {
    return { route: "block", tier: 1, reasons: ["Deal payee is not an allowlisted recipient"] };
  }
  const reasons = capCheck(state, n(milestone.amount));
  if (milestone.status === "Pending") reasons.push("No delivery evidence has been anchored on-chain yet");
  if (reasons.length) return { route: "propose", tier: 1, reasons };
  return {
    route: "execute",
    tier: 2,
    reasons: ["Evidence on-chain, allowlisted payee, within per-tx and daily caps"],
  };
}

const INJECTION_PATTERNS: [RegExp, string][] = [
  [/ignore (all|any|the)? ?(previous|prior|above) (instructions|rules)/i, "Tries to override the agent's instructions"],
  [/\b(system|developer|admin)\s*(prompt|message|override|:)/i, "Impersonates a system/administrator message"],
  [/(transfer|send|move|wire)\s+(all|every|the entire|100%)/i, "Asks to move all funds"],
  [/(do not|don't) (tell|inform|notify|ask)/i, "Asks to hide the action from humans"],
  [/(urgent|immediately|right now|within \d+ minutes)/i, "Uses urgency pressure"],
  [/(new|updated|changed) (bank|wallet|payment|beneficiary) (details|address|account)/i, "Claims payment details changed"],
];

/** Heuristic red flags in an untrusted document. Advisory only; enforcement is the allowlist. */
export function scanForInjection(text: string, state: WalletState): string[] {
  const flags = INJECTION_PATTERNS.filter(([re]) => re.test(text)).map(([, label]) => label);
  const addresses = text.match(/0x[0-9a-fA-F]{40}/g) ?? [];
  const unknown = [...new Set(addresses)].filter(
    (a) =>
      !isAllowlisted(state, a) &&
      !Object.values(state.roles).some((r) => r.toLowerCase() === a.toLowerCase()) &&
      a.toLowerCase() !== state.address.toLowerCase(),
  );
  if (unknown.length) flags.push(`Mentions non-allowlisted address ${unknown.join(", ")}`);
  return flags;
}
