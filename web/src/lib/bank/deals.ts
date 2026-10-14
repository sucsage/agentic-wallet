import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { type Address, type Hex, encodeFunctionData, getAddress, keccak256, toHex } from "viem";

import { agentWalletAbi, fileEscrowAbi, mockTHBAbi } from "../abis";
import { type TxOutcome, atFreshBlock, publicClient, roleAddresses, send } from "../chain";
import { config } from "../config";
import { db } from "../db";
import { type FileDealView, readFileDeals, walletUnits } from "../state";
import { type Mandate, ownerSignMandate } from "./funding";
import { accountOf, openAccount, reserveIdFor, transfer } from "./ledger";

/**
 * File deals after the lock: the buyer's moves (approve, dispute, reclaim, cancel), the demo
 * contractor that plays the seller, and settlement back to the Mock Bank.
 *
 * Only an externally owned key can sell on FileEscrow today (AgentWallet allows buyer moves only),
 * so the seller every tester can trade with is the demo contractor, run by the server. Its moves are
 * automatic and idempotent: each sync looks at the chain and does the next step, if any.
 *
 * Settlement keeps the bank and the chain equal: tokens that leave escrow are redeemed (burned) and
 * the same amount moves out of the reserve, to the seller (PAYOUT) or back to the buyer (REFUND).
 * Each redeem id is derived from the deal and milestone, so a retry can never pay twice.
 */

const KIND_CALL = 2;

export class DealError extends Error {}

const escrow = () => config.bankContracts.fileEscrow;

async function getDeal(dealId: number) {
  return atFreshBlock((blockNumber) =>
    publicClient().readContract({ address: escrow(), abi: fileEscrowAbi, functionName: "getDeal", args: [BigInt(dealId)], blockNumber }),
  );
}

async function getMilestone(dealId: number, index: number) {
  return atFreshBlock((blockNumber) =>
    publicClient().readContract({
      address: escrow(),
      abi: fileEscrowAbi,
      functionName: "getMilestone",
      args: [BigInt(dealId), BigInt(index)],
      blockNumber,
    }),
  );
}

/** A FileEscrow deal the wallet is party to, or a 404-style error. */
export async function dealForWallet(wallet: Address, dealId: number): Promise<FileDealView> {
  const deal = (await readFileDeals(wallet)).find((d) => d.id === dealId);
  if (!deal) throw new DealError("Deal not found for this wallet");
  return deal;
}

// ------------------------------------------------------------------------------------------
// Buyer moves, approved by the user's click (an owner mandate, one transaction)
// ------------------------------------------------------------------------------------------

export type BuyerAction = "approve" | "dispute" | "reclaim" | "cancel";

/**
 * Runs a buyer move through the wallet. Approving a delivery first tries the agent's own path
 * (Tier 2: within its caps and allowlist, recorded as AgentFileApproved); above the caps it falls
 * back to the owner's signed mandate, like every other move here.
 */
export async function buyerAction(
  wallet: Address,
  dealId: number,
  action: BuyerAction,
  index = 0,
): Promise<{ tier: 1 | 2; outcome: TxOutcome }> {
  const deal = await dealForWallet(wallet, dealId);
  if (deal.role !== "buyer") throw new DealError("Only the buyer can do this");

  if (action === "approve") {
    const agent = await send("agent", {
      address: wallet,
      abi: agentWalletAbi,
      functionName: "agentApproveFile",
      args: [escrow(), BigInt(dealId), BigInt(index)],
    });
    if (agent.status === "success") return { tier: 2, outcome: agent };
    // Only a definite refusal (e.g. over the caps) falls back; a network error is reported as is.
    if (!(agent.status === "rejected" && agent.definite)) return { tier: 2, outcome: agent };
  }

  const data =
    action === "cancel"
      ? encodeFunctionData({ abi: fileEscrowAbi, functionName: "cancel", args: [BigInt(dealId)] })
      : encodeFunctionData({ abi: fileEscrowAbi, functionName: action, args: [BigInt(dealId), BigInt(index)] });
  const random = crypto.getRandomValues(new Uint32Array(2));
  const mandate: Mandate = {
    kind: KIND_CALL,
    target: escrow(),
    amount: 0n,
    index: 0n,
    data,
    reasonHash: keccak256(toHex(`${action} deal ${dealId} milestone ${index}`)),
    nonce: (BigInt(random[0]) << 32n) | BigInt(random[1]),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  };
  const signature = await ownerSignMandate(wallet, mandate);
  const outcome = await send("agent", {
    address: wallet,
    abi: agentWalletAbi,
    functionName: "executeMandate",
    args: [mandate, signature],
  });
  return { tier: 1, outcome };
}

// ------------------------------------------------------------------------------------------
// Demo contractor (the seller) and settlement
// ------------------------------------------------------------------------------------------

/** The demo file's plaintext for a milestone; its sha256 is the work hash anchored on-chain. */
function demoFile(dealId: number, index: number): string {
  return `Agentic Wallet demo deliverable · deal ${dealId} · milestone ${index + 1}`;
}

const redeemId = (kind: "payout" | "refund" | "cancel", dealId: number, index = 0): Hex =>
  keccak256(toHex(`${kind}:${config.chain.id}:${escrow()}:${dealId}:${index}`));

async function redeemed(token: Address, holder: Address, id: Hex): Promise<boolean> {
  return atFreshBlock((blockNumber) =>
    publicClient().readContract({ address: token, abi: mockTHBAbi, functionName: "redeemed", args: [holder, id], blockNumber }),
  );
}

/** Burns `amount` held by the demo contractor and pays the contractor's bank account. */
async function payoutContractor(token: Address, currency: "THB" | "CNY", dealId: number, index: number, amount: bigint) {
  const id = redeemId("payout", dealId, index);
  const contractor = roleAddresses().contractor;
  if (!(await redeemed(token, contractor, id))) {
    const out = await send("contractor", { address: token, abi: mockTHBAbi, functionName: "redeem", args: [amount, id] });
    if (out.status !== "success" && !(await redeemed(token, contractor, id))) return;
  }
  const account = await openAccount(contractor, "Demo contractor", currency);
  await transfer({ key: `payout:${id}`, kind: "PAYOUT", fromId: reserveIdFor(currency), toId: account.id, amount });
}

/** Burns money that came back to the buyer's wallet and returns it to their bank account. */
async function refundBuyer(wallet: Address, token: Address, currency: "THB" | "CNY", id: Hex, amount: bigint) {
  const account = await accountOf(wallet);
  if (!account) return;
  if (!(await redeemed(token, wallet, id))) {
    const out = await send("owner", {
      address: wallet,
      abi: agentWalletAbi,
      functionName: "execute",
      args: [token, 0n, encodeFunctionData({ abi: mockTHBAbi, functionName: "redeem", args: [amount, id] })],
    });
    if (out.status !== "success" && !(await redeemed(token, wallet, id))) return;
  }
  await transfer({ key: `refund:${id}`, kind: "REFUND", fromId: reserveIdFor(currency), toId: account.id, amount });
}

const syncing = new Map<string, Promise<void>>();

/**
 * Moves a deal forward by one step where the demo contractor or settlement owes one. Safe to call
 * from any request: concurrent calls for the same deal share one run, and every step re-reads the
 * chain first.
 */
export function syncDeal(wallet: Address, dealId: number): Promise<void> {
  const key = `${wallet}:${dealId}`;
  const running = syncing.get(key);
  if (running) return running;
  const run = doSync(wallet, dealId).finally(() => syncing.delete(key));
  syncing.set(key, run);
  return run;
}

async function doSync(wallet: Address, dealId: number): Promise<void> {
  const units = await walletUnits(wallet);
  if (!units.currency) return;
  const d = await getDeal(dealId);
  if (getAddress(d.buyer) !== wallet) return;
  const isDemoSeller = getAddress(d.seller) === roleAddresses().contractor;
  const now = BigInt(Math.floor(Date.now() / 1000));

  // The offer was withdrawn before acceptance: the whole total came back to the wallet.
  if (d.status === 2) {
    await refundBuyer(wallet, units.address, units.currency, redeemId("cancel", dealId), d.total);
    return;
  }
  if (d.status === 0) {
    if (isDemoSeller) await send("contractor", { address: escrow(), abi: fileEscrowAbi, functionName: "accept", args: [BigInt(dealId)] });
    return;
  }

  for (let i = 0; i < Number(d.milestoneCount); i++) {
    const m = await getMilestone(dealId, i);
    switch (m.status) {
      case 0: // Pending: the demo contractor delivers one milestone at a time
        if (isDemoSeller) {
          const workHash = `0x${createHash("sha256").update(demoFile(dealId, i)).digest("hex")}` as Hex;
          await send("contractor", {
            address: escrow(),
            abi: fileEscrowAbi,
            functionName: "deliver",
            args: [BigInt(dealId), BigInt(i), workHash, `demo-delivery:${dealId}:${i}`],
          });
          return;
        }
        return;
      case 1: // Delivered: the buyer reviews. If the window passes in silence the seller moves on:
        // a no-file milestone is claimed, a file milestone gets its key released.
        if (isDemoSeller && now > m.deadline) {
          await (m.hasFile
            ? send("contractor", {
                address: escrow(),
                abi: fileEscrowAbi,
                functionName: "releaseKey",
                args: [BigInt(dealId), BigInt(i), toHex(randomBytes(32))],
              })
            : send("contractor", { address: escrow(), abi: fileEscrowAbi, functionName: "claim", args: [BigInt(dealId), BigInt(i)] }));
        }
        return;
      case 2: // Approved: hand over the key
        if (isDemoSeller) {
          await send("contractor", {
            address: escrow(),
            abi: fileEscrowAbi,
            functionName: "releaseKey",
            args: [BigInt(dealId), BigInt(i), toHex(randomBytes(32))],
          });
        }
        return;
      case 3: // KeyReleased: claim once the buyer's challenge window has passed
        if (isDemoSeller && now > m.deadline) {
          await send("contractor", { address: escrow(), abi: fileEscrowAbi, functionName: "claim", args: [BigInt(dealId), BigInt(i)] });
        }
        return;
      case 4: // Released: the seller was paid on-chain; settle it in the bank
        if (isDemoSeller) await payoutContractor(units.address, units.currency, dealId, i, m.amount);
        continue;
      case 5: // Disputed: waits for the arbiter
        return;
      case 6: // Refunded: back to the buyer's bank
        await refundBuyer(wallet, units.address, units.currency, redeemId("refund", dealId, i), m.amount);
        continue;
    }
  }
}

/** The demo file a buyer receives once the key is released (stand-in for decrypting the real file). */
export function demoDeliverable(dealId: number, index: number) {
  const text = demoFile(dealId, index);
  return { text, sha256: createHash("sha256").update(text).digest("hex") };
}

/** Bank-side terms of a deal the user drafted (title, milestone names), if any. */
export async function dealTerms(userId: string, dealId: number) {
  return db.dealDraft.findFirst({ where: { userId, dealId } });
}
