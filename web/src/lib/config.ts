import "server-only";

import { type Address, type Chain, type Hex, getAddress, isHex } from "viem";
import { baseSepolia, hardhat } from "viem/chains";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

function addr(name: string): Address {
  return getAddress(env(name));
}

function key(name: string): Hex {
  const v = env(name);
  const k = (v.startsWith("0x") ? v : `0x${v}`) as Hex;
  if (!isHex(k) || k.length !== 66) throw new Error(`${name} is not a 32-byte private key`);
  return k;
}

const chains: Record<string, Chain> = { baseSepolia, hardhat };

export const config = {
  get chain(): Chain {
    const c = chains[process.env.CHAIN ?? "hardhat"];
    if (!c) throw new Error(`Unsupported CHAIN ${process.env.CHAIN}`);
    return c;
  },
  get rpcUrl() {
    return process.env.RPC_URL ?? "http://127.0.0.1:8545";
  },
  get contracts() {
    return {
      usdc: addr("USDC_ADDRESS"),
      escrow: addr("ESCROW_ADDRESS"),
      factory: addr("FACTORY_ADDRESS"),
    };
  },
  /** First block worth scanning for events (the escrow deployment block). */
  get startBlock() {
    return BigInt(process.env.START_BLOCK ?? "0");
  },
  /**
   * Demo role keys. TESTNET ONLY. In production each human signs with their own wallet and the
   * agent key lives in a KMS/HSM; here the server signs for every role so judges can click through.
   */
  get keys() {
    return {
      owner: key("OWNER_PRIVATE_KEY"),
      agent: key("AGENT_PRIVATE_KEY"),
      approverA: key("APPROVER_A_PRIVATE_KEY"),
      approverB: key("APPROVER_B_PRIVATE_KEY"),
      contractor: key("CONTRACTOR_PRIVATE_KEY"),
    };
  },
};

/** Policy defaults for every new sandbox wallet (6-decimal mUSDC units). */
export const walletDefaults = {
  maxPerTx: 500_000_000n, // 500 mUSDC
  dailyLimit: 1_000_000_000n, // 1,000 mUSDC
  sessionDays: 7n,
  threshold: 2n,
  seed: 10_000_000_000n, // 10,000 mUSDC
};

/** A fixed attacker address used by the injection demos. Never allowlisted. */
export const ATTACKER: Address = "0xBAd0000000000000000000000000000000000Bad";

export function explorerTx(hash: string): string | null {
  const url = config.chain.blockExplorers?.default.url;
  return url ? `${url}/tx/${hash}` : null;
}

export function explorerAddress(address: string): string | null {
  const url = config.chain.blockExplorers?.default.url;
  return url ? `${url}/address/${address}` : null;
}
