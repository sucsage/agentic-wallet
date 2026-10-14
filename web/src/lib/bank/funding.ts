import "server-only";

import {
  type Address,
  type Hex,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toHex,
} from "viem";

import { agentWalletAbi, fileEscrowAbi, mockTHBAbi } from "../abis";
import { type TxOutcome, account, publicClient, send } from "../chain";
import { config } from "../config";
import { db } from "../db";
import { InsufficientFunds, RESERVE_ID, accountOf, transfer } from "./ledger";

/**
 * fundJustInTime: pays for a file deal with Mock Bank baht, at the moment the deal is made.
 *
 *   1. check   the owner signed the mandate, the bank account can cover it      -> else REJECTED
 *   2. debit   buyer's bank account -> reserve (this transfer is the funding record)
 *   3. mint    the same amount of mTHB into the buyer's AgentWallet
 *   4. lock    the agent runs the mandate: the wallet makes the offer and the escrow locks the money
 *
 * The bank and the chain cannot change together, so each step is keyed by one funding id, the
 * mandate's EIP-712 digest, and can be retried without doing it twice. Nothing is remembered in
 * between: every call reads back from the bank and the chain what already happened.
 *
 * A step that fails is refunded ONLY when the failure is certain (the contract refused it, or its
 * receipt shows a revert). If the network failed instead, the transaction may still land, so the
 * funding stays PENDING and the caller retries later. Refunding first revokes the mandate, so no
 * late or replayed transaction can lock the money after it went back to the buyer.
 */

export const KIND_SETUP_FILE_DEAL = 4;

export type Mandate = {
  kind: number;
  target: Address;
  amount: bigint;
  index: bigint;
  data: Hex;
  reasonHash: Hex;
  nonce: bigint;
  deadline: bigint;
};

const MANDATE_TYPES = {
  Mandate: [
    { name: "kind", type: "uint8" },
    { name: "target", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "index", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "reasonHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

function typedMandate(wallet: Address, m: Mandate) {
  return {
    domain: { name: "AgentWallet", version: "1", chainId: config.chain.id, verifyingContract: wallet },
    types: MANDATE_TYPES,
    primaryType: "Mandate",
    message: m,
  } as const;
}

/** FUNDED: money locked in the escrow. REFUNDED: it failed and the baht went back.
 *  PENDING: debited, the lock's outcome is not known yet; retry later, never refund by hand.
 *  COMPENSATING: the lock failed and the refund did not finish; retry to finish it.
 *  REJECTED: refused before any money moved. */
export type FundingStatus = "FUNDED" | "REFUNDED" | "PENDING" | "COMPENSATING" | "REJECTED";

export type FundingStep = {
  step: "debit" | "mint" | "lock" | "revoke" | "redeem" | "refund";
  outcome?: TxOutcome;
  /** Already done by an earlier attempt, so skipped this time. */
  done?: true;
};

export type FundingResult = {
  status: FundingStatus;
  fundingId: Hex;
  amount: bigint;
  dealId?: number;
  steps: FundingStep[];
  error?: string;
};

export type FileOffer = {
  seller: Address;
  milestones: { amount: bigint; hasFile: boolean }[];
  reviewPeriod: bigint;
  termsURI: string;
};

/** Builds the mandate for a buyer's offer: the wallet locks `amount` in the escrow when it runs. */
export function fileOfferMandate(offer: FileOffer, reason: string, validForSeconds = 3_600): Mandate {
  const terms = offer.milestones.map((m) => ({ amount: m.amount, hasFile: m.hasFile, workHash: `0x${"0".repeat(64)}` as Hex }));
  const random = crypto.getRandomValues(new Uint32Array(2));
  return {
    kind: KIND_SETUP_FILE_DEAL,
    target: config.bankContracts.fileEscrow,
    amount: terms.reduce((sum, t) => sum + t.amount, 0n),
    index: 0n,
    data: encodeFunctionData({
      abi: fileEscrowAbi,
      functionName: "offerToBuy",
      args: [getAddress(offer.seller), config.arbiter, config.bankContracts.mthb, terms, offer.reviewPeriod, offer.termsURI],
    }),
    // Only the reason's hash is signed; its text stays off-chain (PDPA).
    reasonHash: keccak256(toHex(reason)),
    nonce: (BigInt(random[0]) << 32n) | BigInt(random[1]),
    deadline: BigInt(Math.floor(Date.now() / 1000) + validForSeconds),
  };
}

/** The owner approves by signing. Demo: the server holds the owner key, like every other role. */
export function ownerSignMandate(wallet: Address, m: Mandate): Promise<Hex> {
  return account("owner").signTypedData!(typedMandate(getAddress(wallet), m));
}

export async function fundJustInTime(walletInput: Address, m: Mandate, signature: Hex): Promise<FundingResult> {
  const wallet = getAddress(walletInput);
  const { mthb, fileEscrow } = config.bankContracts;
  const pc = publicClient();
  const fundingId = hashTypedData(typedMandate(wallet, m));
  const keys = { debit: `funding:${fundingId}:debit`, refund: `funding:${fundingId}:refund` };
  const steps: FundingStep[] = [];
  const result = (status: FundingStatus, extra: { dealId?: number; error?: string } = {}): FundingResult => ({
    status,
    fundingId,
    amount: m.amount,
    steps,
    ...extra,
  });

  const minted = () => pc.readContract({ address: mthb, abi: mockTHBAbi, functionName: "minted", args: [fundingId] });
  const mandateUsed = () =>
    pc.readContract({ address: wallet, abi: agentWalletAbi, functionName: "mandateUsed", args: [fundingId] });
  const debitRow = () => db.bankTransfer.findUnique({ where: { idempotencyKey: keys.debit } });

  // 1. Check. Nothing moves until the owner's signature and the request itself are confirmed.
  if (m.kind !== KIND_SETUP_FILE_DEAL || getAddress(m.target) !== fileEscrow || m.amount <= 0n) {
    return result("REJECTED", { error: "Only a buyer's file-deal offer can be funded from the bank" });
  }
  const owner = await pc.readContract({ address: wallet, abi: agentWalletAbi, functionName: "owner" });
  const signer = await recoverTypedDataAddress({ ...typedMandate(wallet, m), signature });
  if (signer !== getAddress(owner)) return result("REJECTED", { error: "The mandate is not signed by the wallet owner" });

  // Resume: an earlier attempt may have got part or all of the way.
  const locked = await findLock(wallet, fundingId);
  if (locked !== null) return result("FUNDED", { dealId: locked.dealId });
  if (await db.bankTransfer.findUnique({ where: { idempotencyKey: keys.refund } })) return result("REFUNDED");
  // Used but not run as a lock means an earlier attempt revoked it and was refunding.
  if (await mandateUsed()) return compensate();

  const bankAccount = await accountOf(wallet);
  if (!bankAccount) return result("REJECTED", { error: "This wallet has no Mock Bank account" });

  // 2. Debit. The transfer row is the funding record, written before anything happens on-chain.
  const alreadyDebited = (await debitRow()) !== null;
  try {
    await transfer({ key: keys.debit, kind: "FUND", fromId: bankAccount.id, toId: RESERVE_ID, amount: m.amount });
  } catch (err) {
    if (err instanceof InsufficientFunds) return result("REJECTED", { error: "Not enough baht in the bank account" });
    throw err;
  }
  steps.push(alreadyDebited ? { step: "debit", done: true } : { step: "debit" });

  // 3. Mint. The id makes a second mint impossible, so after an unclear failure ask the chain.
  if (await minted()) {
    steps.push({ step: "mint", done: true });
  } else {
    const outcome = await send("bank", {
      address: mthb,
      abi: mockTHBAbi,
      functionName: "mint",
      args: [wallet, m.amount, fundingId],
    });
    steps.push({ step: "mint", outcome });
    if (outcome.status === "success") {
      await db.bankTransfer.update({ where: { idempotencyKey: keys.debit }, data: { txHash: outcome.hash } });
    } else if (!(await minted())) {
      return isCertainFailure(outcome) ? compensate(outcome) : result("PENDING", { error: outcome.error });
    }
  }

  // 4. Lock. The agent sends the owner's mandate; the wallet re-checks the seller, token and arbiter.
  const outcome = await send("agent", {
    address: wallet,
    abi: agentWalletAbi,
    functionName: "executeMandate",
    args: [m, signature],
  });
  steps.push({ step: "lock", outcome });
  const lock = await findLock(wallet, fundingId, outcome.status === "success" ? outcome.hash : undefined);
  if (lock !== null) return result("FUNDED", { dealId: lock.dealId });
  if (isCertainFailure(outcome)) return compensate(outcome);
  return result("PENDING", { error: "error" in outcome ? outcome.error : "The lock was mined but not found" });

  /** Undoes a funding whose lock failed for certain, in an order that is safe to retry at any step. */
  async function compensate(cause?: TxOutcome): Promise<FundingResult> {
    const error = cause && "error" in cause ? cause.error : undefined;
    const stuck = (why: string) => result("COMPENSATING", { error: error ? `${error}; ${why}` : why });

    // a. Revoke first: once the mandate is void, the lock can never happen behind the refund's back.
    if (!(await mandateUsed())) {
      const revoke = await send("owner", {
        address: wallet,
        abi: agentWalletAbi,
        functionName: "revokeMandate",
        args: [fundingId],
      });
      steps.push({ step: "revoke", outcome: revoke });
      // The lock may have landed after all (e.g. it was only slow); then it is funded, not failed.
      const late = await findLock(wallet, fundingId);
      if (late !== null) return result("FUNDED", { dealId: late.dealId });
      if (!(await mandateUsed())) return stuck("could not revoke the mandate");
    }

    // b. Burn the tokens minted for this funding, so mTHB in circulation matches the reserve again.
    if (await minted()) {
      const redeemed = () =>
        pc.readContract({ address: mthb, abi: mockTHBAbi, functionName: "redeemed", args: [wallet, fundingId] });
      if (await redeemed()) {
        steps.push({ step: "redeem", done: true });
      } else {
        const redeem = await send("owner", {
          address: wallet,
          abi: agentWalletAbi,
          functionName: "execute",
          args: [
            mthb,
            0n,
            encodeFunctionData({ abi: mockTHBAbi, functionName: "redeem", args: [m.amount, fundingId] }),
          ],
        });
        steps.push({ step: "redeem", outcome: redeem });
        if (redeem.status !== "success" && !(await redeemed())) return stuck("could not burn the minted mTHB");
      }
    }

    // c. Give the baht back. Same key on every retry, so it is paid back once.
    const debit = await debitRow();
    if (debit) {
      try {
        await transfer({ key: keys.refund, kind: "REFUND", fromId: RESERVE_ID, toId: debit.fromId!, amount: debit.amount });
      } catch (err) {
        return stuck(`could not refund the bank account: ${err instanceof Error ? err.message : String(err)}`);
      }
      steps.push({ step: "refund" });
    }
    return result("REFUNDED", { error });
  }
}

/** Mined and reverted, or refused by the contract before sending: it did not and will not happen. */
function isCertainFailure(outcome: TxOutcome): boolean {
  return outcome.status === "reverted" || (outcome.status === "rejected" && outcome.definite === true);
}

/**
 * Finds the wallet's record of this mandate having run. Revoked mandates leave no record, so this
 * tells a lock apart from a revoke. Sandbox wallets have few proposals, so a scan is fine here.
 * With the lock's transaction hash, also reads the escrow deal id from its receipt.
 */
async function findLock(wallet: Address, digest: Hex, lockTx?: Hex): Promise<{ dealId?: number } | null> {
  const pc = publicClient();
  const count = await pc.readContract({ address: wallet, abi: agentWalletAbi, functionName: "proposalCount" });
  for (let id = count; id > 0n; id--) {
    const p = await pc.readContract({ address: wallet, abi: agentWalletAbi, functionName: "getProposal", args: [id - 1n] });
    if (p.mandateHash !== digest) continue;
    if (!lockTx) return {};
    const receipt = await pc.getTransactionReceipt({ hash: lockTx });
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== config.bankContracts.fileEscrow) continue;
      try {
        const event = decodeEventLog({ abi: fileEscrowAbi, data: log.data, topics: log.topics });
        if (event.eventName === "OfferCreated") return { dealId: Number(event.args.dealId) };
      } catch {
        // another event from the escrow
      }
    }
    return {};
  }
  return null;
}
