import "server-only";

import {
  type Abi,
  type Account,
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { agentWalletAbi, fileEscrowAbi, milestoneEscrowAbi, mockTHBAbi, mockUSDCAbi } from "./abis";
import { config, explorerTx } from "./config";

const ERROR_ABI = [...agentWalletAbi, ...milestoneEscrowAbi, ...mockUSDCAbi, ...mockTHBAbi, ...fileEscrowAbi].filter(
  (i) => i.type === "error",
);

/** `bank` is the Mock Bank server, not a person: it only mints mTHB. */
export type Role = "owner" | "agent" | "contractor" | "bank";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  agent: "AI Agent",
  contractor: "Contractor",
  bank: "Mock Bank",
};

let _public: ReturnType<typeof makePublic> | undefined;
function makePublic() {
  const base = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) });
  // Every contract read sees at least what this process already confirmed (see freshBlock), unless
  // the caller pinned a block itself. Without this, a page read right after a write can show the old state.
  return base.extend((c) => ({
    readContract: ((args: Parameters<typeof c.readContract>[0]) =>
      args.blockNumber !== undefined || args.blockTag !== undefined
        ? c.readContract(args)
        : atFreshBlock((blockNumber) => c.readContract({ ...args, blockNumber }))) as typeof c.readContract,
  })) as unknown as typeof base;
}
export function publicClient() {
  return (_public ??= makePublic());
}

const accounts = new Map<Role, Account>();
export function account(role: Role): Account {
  let a = accounts.get(role);
  if (!a) {
    a = privateKeyToAccount(role === "bank" ? config.bankKey : config.keys[role]);
    accounts.set(role, a);
  }
  return a;
}

export function roleAddresses(): Record<Exclude<Role, "bank">, Address> {
  return {
    owner: account("owner").address,
    agent: account("agent").address,
    contractor: account("contractor").address,
  };
}

function walletClient(role: Role) {
  return createWalletClient({ account: account(role), chain: config.chain, transport: http(config.rpcUrl) });
}

// One in-flight transaction per role per server instance, so nonces don't collide.
const queues = new Map<Role, Promise<unknown>>();
function serialize<T>(role: Role, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(role) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(
    role,
    next.catch(() => undefined),
  );
  return next;
}

export type TxOutcome =
  | { status: "success"; hash: Hex; url: string | null; result?: unknown }
  | { status: "reverted"; hash: Hex; url: string | null; error: string }
  /** `definite`: the contract itself refused (simulation reverted), so nothing was or will be mined.
   *  Without it the failure may be the network's, and the transaction may still have landed. */
  | { status: "rejected"; error: string; definite?: true };

/** True when the error is the contract refusing the call, not the RPC or network failing. */
function isContractRevert(err: unknown): boolean {
  if (!(err instanceof Error && "walk" in err)) return false;
  return (err as BaseError).walk((e) => (e as Error).name === "ContractFunctionRevertedError") !== null;
}

/**
 * Public RPCs such as sepolia.base.org are load-balanced: right after a transaction confirms, the
 * next request can land on a node a block or two behind and see the old state (a balance of 0
 * right after a mint). So every read or simulation that follows our own writes is pinned to a
 * block at least as new as the last receipt we saw; a node that lacks it errors and is retried.
 */
let confirmedBlock = 0n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastFresh: { n: bigint; at: number } | null = null;

/** A block number no older than any transaction this process has confirmed (reused for 1 s). */
export async function freshBlock(): Promise<bigint> {
  if (lastFresh && lastFresh.n >= confirmedBlock && Date.now() - lastFresh.at < 1000) return lastFresh.n;
  for (let i = 0; i < 20; i++) {
    const n = await publicClient().getBlockNumber({ cacheTime: 0 });
    if (n >= confirmedBlock) {
      lastFresh = { n, at: Date.now() };
      return n;
    }
    await sleep(500);
  }
  return confirmedBlock;
}

/** Runs `fn` at a fresh block, retrying while the node answering has not caught up to it. */
export async function atFreshBlock<T>(fn: (blockNumber: bigint) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const block = await freshBlock();
    try {
      return await fn(block);
    } catch (err) {
      // A contract revert is a real answer; anything else may be a node without that block.
      if (isContractRevert(err) || attempt >= 5) throw err;
      await sleep(800);
    }
  }
}

/** Turns a viem error into a short readable reason, e.g. `RecipientNotAllowed(0xBad…)`. */
export function revertReason(err: unknown): string {
  const fmt = (name: string, args?: readonly unknown[]) =>
    args?.length ? `${name}(${args.map((a) => (typeof a === "bigint" ? a.toString() : String(a))).join(", ")})` : name;
  if (err instanceof Error && "walk" in err) {
    const be = err as BaseError;
    // Match by name, not instanceof: bundlers/loaders can end up with two copies of viem.
    const revert = be.walk((e) => (e as Error).name === "ContractFunctionRevertedError") as
      | ContractFunctionRevertedError
      | null;
    if (revert?.data?.errorName) return fmt(revert.data.errorName, revert.data.args);
    // Some public RPCs (e.g. sepolia.base.org) return the revert data in a shape viem doesn't
    // decode for us; find the raw selector + args anywhere in the cause chain and decode it.
    const withData = be.walk((e) => typeof (e as { data?: unknown }).data === "string");
    const data = (withData as { data?: string } | null)?.data;
    if (data?.startsWith("0x") && data.length >= 10) {
      try {
        const decoded = decodeErrorResult({ abi: ERROR_ABI, data: data as Hex });
        return fmt(decoded.errorName, decoded.args as readonly unknown[] | undefined);
      } catch {
        // unknown selector: fall through
      }
    }
    if (revert?.reason) return revert.reason;
    return be.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Contract return values can contain bigints, which Response.json() cannot serialize. */
function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  return v;
}

function isNonceError(err: unknown) {
  const be = err as Partial<BaseError>;
  const msg = be?.shortMessage ? `${be.details ?? ""}${be.shortMessage}` : String(err);
  return /nonce|replacement transaction underpriced|already known/i.test(msg);
}

/**
 * Simulates, then sends a contract write as `role` and waits for the receipt.
 * With `force`, skips the simulation gate and sends anyway with a fixed gas limit, so a policy
 * violation lands on-chain as a reverted transaction (used by the attack demo).
 */
export async function send<
  const abi extends Abi,
  fn extends ContractFunctionName<abi, "nonpayable" | "payable">,
>(
  role: Role,
  call: {
    address: Address;
    abi: abi;
    functionName: fn;
    args: ContractFunctionArgs<abi, "nonpayable" | "payable", fn>;
  },
  opts: { force?: boolean } = {},
): Promise<TxOutcome> {
  const pc = publicClient();
  const wc = walletClient(role);

  let simulated: { result: unknown } | undefined;
  let simulationError: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    simulated = await atFreshBlock((blockNumber) => pc.simulateContract({ ...(call as any), account: account(role), blockNumber }));
  } catch (err) {
    simulationError = revertReason(err);
    if (!opts.force) {
      return isContractRevert(err) ? { status: "rejected", error: simulationError, definite: true } : { status: "rejected", error: simulationError };
    }
  }

  return serialize(role, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        // Gas is estimated at a fresh block too: a stale node would estimate a revert and refuse.
        const gas = opts.force
          ? 400_000n
          : await atFreshBlock((blockNumber) =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pc.estimateContractGas({ ...(call as any), account: account(role), blockNumber }),
            ).then((g) => (g * 12n) / 10n);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hash = await wc.writeContract({ ...(call as any), gas });
        const receipt = await pc.waitForTransactionReceipt({ hash });
        if (receipt.blockNumber > confirmedBlock) confirmedBlock = receipt.blockNumber;
        if (receipt.status === "success") {
          return { status: "success", hash, url: explorerTx(hash), result: jsonSafe(simulated?.result) };
        }
        // The pre-send simulation can miss the reason: a load-balanced public RPC may not have seen a
        // contract created moments earlier (a call to an address without code "succeeds"). Replaying
        // the call at the block where it reverted recovers the real reason.
        let reason = simulationError;
        if (!reason) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await pc.simulateContract({ ...(call as any), account: account(role), blockNumber: receipt.blockNumber });
          } catch (err) {
            reason = revertReason(err);
          }
        }
        return { status: "reverted", hash, url: explorerTx(hash), error: reason ?? "reverted" };
      } catch (err) {
        if (attempt < 3 && isNonceError(err)) continue;
        return { status: "rejected", error: revertReason(err) };
      }
    }
  });
}
