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
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { config, explorerTx } from "./config";

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
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason ?? "reverted";
      const args = revert.data?.args?.map((a) => (typeof a === "bigint" ? a.toString() : String(a)));
      return args?.length ? `${name}(${args.join(", ")})` : name;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

function isNonceError(err: unknown) {
  const msg = err instanceof BaseError ? err.details + err.shortMessage : String(err);
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
          return { status: "success", hash, url: explorerTx(hash), result: simulated?.result };
        }
        return { status: "reverted", hash, url: explorerTx(hash), error: simulationError ?? "reverted" };
      } catch (err) {
        if (attempt < 3 && isNonceError(err)) continue;
        return { status: "rejected", error: revertReason(err) };
      }
    }
  });
}
