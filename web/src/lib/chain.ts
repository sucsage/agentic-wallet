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

import { agentWalletAbi, milestoneEscrowAbi, mockUSDCAbi } from "./abis";
import { config, explorerTx } from "./config";

const ERROR_ABI = [...agentWalletAbi, ...milestoneEscrowAbi, ...mockUSDCAbi].filter((i) => i.type === "error");

export type Role = "owner" | "agent" | "approverA" | "approverB" | "contractor";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  agent: "AI Agent",
  approverA: "Approver A",
  approverB: "Approver B",
  contractor: "Contractor",
};

let _public: ReturnType<typeof makePublic> | undefined;
function makePublic() {
  return createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) });
}
export function publicClient() {
  return (_public ??= makePublic());
}

const accounts = new Map<Role, Account>();
export function account(role: Role): Account {
  let a = accounts.get(role);
  if (!a) {
    a = privateKeyToAccount(config.keys[role]);
    accounts.set(role, a);
  }
  return a;
}

export function roleAddresses(): Record<Role, Address> {
  return {
    owner: account("owner").address,
    agent: account("agent").address,
    approverA: account("approverA").address,
    approverB: account("approverB").address,
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
  | { status: "rejected"; error: string };

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
    simulated = await pc.simulateContract({ ...(call as any), account: account(role) });
  } catch (err) {
    simulationError = revertReason(err);
    if (!opts.force) return { status: "rejected", error: simulationError };
  }

  return serialize(role, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hash = await wc.writeContract({ ...(call as any), gas: opts.force ? 400_000n : undefined });
        const receipt = await pc.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
          return { status: "success", hash, url: explorerTx(hash), result: jsonSafe(simulated?.result) };
        }
        return { status: "reverted", hash, url: explorerTx(hash), error: simulationError ?? "reverted" };
      } catch (err) {
        if (attempt < 3 && isNonceError(err)) continue;
        return { status: "rejected", error: revertReason(err) };
      }
    }
  });
}
