import "server-only";

import { type Address, type Hex, encodeFunctionData, getAddress, keccak256, parseUnits, toHex } from "viem";

import type { Currency } from "@/generated/prisma/client";

import { agentWalletAbi, agentWalletFactoryAbi, milestoneEscrowAbi } from "./abis";
import { seedSandbox } from "./bank/ledger";
import { type Role, type TxOutcome, account, publicClient, roleAddresses, send } from "./chain";
import { ATTACKER, bankWalletDefaults, config, walletDefaults } from "./config";
import { type Decision, evaluateRelease, evaluateTransfer } from "./policy";
import { type DealTerms, type EvidenceDoc, readWallet, toDataUri, walletUnits } from "./state";

export type ActionResult = {
  action: string;
  decision?: Decision;
  outcome?: TxOutcome;
  detail?: string;
};

const KIND = { Transfer: 0, ReleaseMilestone: 1, Call: 2, SetupDeal: 3 } as const;

/**
 * Deploys a fresh, fully configured sandbox wallet in one transaction.
 *
 * With `currency` (a Mock Bank customer's THB or CNY) the wallet settles in mTHB / mCNY and holds
 * nothing: deals are paid just in time from the customer's bank account (see bank/funding.ts).
 * Without it, or while that token is not deployed, it is the older mUSDC sandbox with seed money.
 */
export async function createWorkspace(
  opts: { currency?: Currency } = {},
): Promise<{ address: Address; outcome: TxOutcome; units: { symbol: string; decimals: number } }> {
  const roles = roleAddresses();
  const latest = await publicClient().getBlock();
  const bankToken = opts.currency ? config.bankToken(opts.currency) : null;
  const limits = bankToken && opts.currency ? bankWalletDefaults[opts.currency] : walletDefaults;
  const outcome = await send("owner", {
    address: config.contracts.factory,
    abi: agentWalletFactoryAbi,
    functionName: "createWallet",
    args: [
      {
        owner: roles.owner,
        token: bankToken ?? config.contracts.usdc,
        agent: roles.agent,
        sessionExpiresAt: latest.timestamp + walletDefaults.sessionDays * 86_400n,
        maxPerTx: limits.maxPerTx,
        dailyLimit: limits.dailyLimit,
        approvers: [roles.owner],
        threshold: walletDefaults.threshold,
        recipients: [roles.contractor],
        escrows: [config.contracts.escrow],
      },
      // Bank wallets hold no idle money; the factory could not mint mTHB / mCNY anyway.
      bankToken ? 0n : walletDefaults.seed,
    ],
  });
  if (outcome.status !== "success") throw new Error(`Wallet creation failed: ${"error" in outcome ? outcome.error : ""}`);
  const address = getAddress(outcome.result as Address);

  if (bankToken) {
    // File deals go through FileEscrow, which the factory's Config cannot allowlist yet.
    const allow = await send("owner", {
      address,
      abi: agentWalletAbi,
      functionName: "setFileEscrow",
      args: [config.bankContracts.fileEscrow, true],
    });
    if (allow.status !== "success") throw new Error(`Allowlisting FileEscrow failed: ${"error" in allow ? allow.error : ""}`);
    return { address, outcome, units: { symbol: opts.currency === "CNY" ? "mCNY" : "mTHB", decimals: 2 } };
  }
  await seedSandbox(address, walletDefaults.bankSeed);
  return { address, outcome, units: { symbol: "mUSDC", decimals: 6 } };
}

export async function proposeDealSetup(
  wallet: Address,
  input: { payee: string; po: string; title: string; summary: string; milestones: { name: string; amount: number; due?: string; acceptance?: string }[] },
): Promise<ActionResult> {
  const state = await readWallet(wallet);
  if (state.paused) {
    return { action: "propose_deal_setup", decision: { route: "block", tier: 3, reasons: ["Wallet is paused"] } };
  }
  const terms: DealTerms = {
    po: input.po,
    title: input.title,
    summary: input.summary,
    milestones: input.milestones.map((m) => ({ name: m.name, due: m.due, acceptance: m.acceptance })),
  };
  const data = encodeFunctionData({
    abi: milestoneEscrowAbi,
    functionName: "createDeal",
    args: [
      getAddress(input.payee),
      config.arbiter,
      // The deal must settle in the wallet's own token (mUSDC, mTHB or mCNY).
      (await walletUnits(wallet)).address,
      input.milestones.map((m) => parseUnits(String(m.amount), state.token.decimals)),
      toDataUri(terms),
    ],
  });
  const decision: Decision = {
    route: "propose",
    tier: 1,
    reasons: ["Committing funds to a new deal always needs human approval"],
  };
  const outcome = await send("agent", {
    address: wallet,
    abi: agentWalletAbi,
    functionName: "propose",
    args: [KIND.SetupDeal, config.contracts.escrow, 0n, 0n, data, `${input.po}: ${input.summary}`.slice(0, 280)],
  });
  return { action: "propose_deal_setup", decision, outcome };
}

export async function releaseMilestone(
  wallet: Address,
  dealId: number,
  index: number,
  justification: string,
): Promise<ActionResult> {
  const state = await readWallet(wallet);
  const deal = state.deals.find((d) => d.id === dealId);
  const decision = evaluateRelease(state, deal, deal?.milestones[index]);
  if (decision.route === "block") return { action: "release_milestone", decision };

  const outcome =
    decision.route === "execute"
      ? await send("agent", {
          address: wallet,
          abi: agentWalletAbi,
          functionName: "agentReleaseMilestone",
          args: [config.contracts.escrow, BigInt(dealId), BigInt(index)],
        })
      : await send("agent", {
          address: wallet,
          abi: agentWalletAbi,
          functionName: "propose",
          args: [
            KIND.ReleaseMilestone,
            config.contracts.escrow,
            BigInt(dealId),
            BigInt(index),
            "0x",
            justification.slice(0, 280),
          ],
        });
  return { action: "release_milestone", decision, outcome };
}

export async function transfer(wallet: Address, to: string, amount: number, reason: string): Promise<ActionResult> {
  const state = await readWallet(wallet);
  const decision = evaluateTransfer(state, to, amount);
  if (decision.route === "block") return { action: "transfer", decision };
  const raw = parseUnits(String(amount), state.token.decimals);
  const recipient = getAddress(to);
  const outcome =
    decision.route === "execute"
      ? await send("agent", {
          address: wallet,
          abi: agentWalletAbi,
          functionName: "agentTransfer",
          args: [recipient, raw],
        })
      : await send("agent", {
          address: wallet,
          abi: agentWalletAbi,
          functionName: "propose",
          args: [KIND.Transfer, recipient, raw, 0n, "0x", reason.slice(0, 280)],
        });
  return { action: "transfer", decision, outcome };
}

export async function pause(wallet: Address, role: Role, reason?: string): Promise<ActionResult> {
  const outcome = await send(role, { address: wallet, abi: agentWalletAbi, functionName: "pause", args: [] });
  return { action: "pause_wallet", outcome, detail: reason };
}

export async function unpause(wallet: Address): Promise<ActionResult> {
  const outcome = await send("owner", { address: wallet, abi: agentWalletAbi, functionName: "unpause", args: [] });
  return { action: "unpause", outcome };
}

export async function revokeSession(wallet: Address): Promise<ActionResult> {
  const outcome = await send("owner", {
    address: wallet,
    abi: agentWalletAbi,
    functionName: "revokeSession",
    args: [account("agent").address],
  });
  return { action: "revoke_session", outcome };
}

export async function restoreSession(wallet: Address): Promise<ActionResult> {
  const latest = await publicClient().getBlock();
  const { currency } = await walletUnits(wallet);
  const limits = currency ? bankWalletDefaults[currency] : walletDefaults;
  const outcome = await send("owner", {
    address: wallet,
    abi: agentWalletAbi,
    functionName: "setSession",
    args: [
      account("agent").address,
      latest.timestamp + walletDefaults.sessionDays * 86_400n,
      limits.maxPerTx,
      limits.dailyLimit,
    ],
  });
  return { action: "restore_session", outcome };
}

export async function approveProposal(wallet: Address, id: number): Promise<ActionResult> {
  const outcome = await send("owner", { address: wallet, abi: agentWalletAbi, functionName: "approve", args: [BigInt(id)] });
  return { action: "approve", outcome };
}

export async function cancelProposal(wallet: Address, id: number): Promise<ActionResult> {
  const outcome = await send("owner", { address: wallet, abi: agentWalletAbi, functionName: "cancel", args: [BigInt(id)] });
  return { action: "cancel", outcome };
}

/** The contractor anchors a hash of the delivery evidence; the document itself rides in a data: URI. */
export async function submitEvidence(dealId: number, index: number, doc: EvidenceDoc): Promise<ActionResult> {
  const text = doc.text ?? "";
  const hash: Hex = keccak256(toHex(text));
  const outcome = await send("contractor", {
    address: config.contracts.escrow,
    abi: milestoneEscrowAbi,
    functionName: "submitEvidence",
    args: [BigInt(dealId), BigInt(index), hash, toDataUri({ ...doc, text: text.slice(0, 6000) })],
  });
  return { action: "submit_evidence", outcome, detail: hash };
}

/**
 * Attack demo: the agent key is used directly, bypassing the off-chain policy engine entirely,
 * to send "all funds" to an attacker. The transaction is forced on-chain so the revert is provable.
 */
export async function rawAttack(wallet: Address): Promise<ActionResult> {
  const units = await walletUnits(wallet);
  const outcome = await send(
    "agent",
    {
      address: wallet,
      abi: agentWalletAbi,
      functionName: "agentTransfer",
      args: [ATTACKER, parseUnits("5000", units.decimals)],
    },
    { force: true },
  );
  return { action: "raw_attack", outcome, detail: `agentTransfer(${ATTACKER}, 5000 ${units.symbol}) sent without the policy engine` };
}
