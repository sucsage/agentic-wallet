import "server-only";

import { type Address, type Chain, type Hex, defineChain, getAddress, isHex } from "viem";
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

/**
 * The private Besu chain (../chain): free gas, only the server's keys may send transactions (account
 * permissioning), and its RPC needs the server's token. Reading is public: the app's explorer at
 * /explorer and read-only JSON-RPC at /api/rpc, which is where these links point.
 */
const besu = defineChain({
  id: 20261020,
  name: "Kravii private chain",
  nativeCurrency: { name: "Gas (no value)", symbol: "GAS", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8555"] } },
  blockExplorers: { default: { name: "Kravii explorer", url: "/explorer" } },
});

const chains: Record<string, Chain> = { baseSepolia, hardhat, besu };

export const config = {
  /**
   * Disputes are turned off (2026-10-19): the buyer approves or asks for changes; nobody can open a
   * new dispute. Disputes already open still run to their ruling. DISPUTES=on turns them back on.
   */
  disputesOpen: process.env.DISPUTES === "on",
  get chain(): Chain {
    const c = chains[process.env.CHAIN ?? "hardhat"];
    if (!c) throw new Error(`Unsupported CHAIN ${process.env.CHAIN}`);
    return c;
  },
  /**
   * Headers for every RPC request. CHAIN_TOKEN is the bearer JWT the private chain's Besu node
   * requires (chain/docker-compose.server.yml); Vercel has no fixed IP to allowlist instead.
   */
  get rpcHeaders(): Record<string, string> | undefined {
    const token = process.env.CHAIN_TOKEN?.trim();
    return token ? { authorization: `Bearer ${token}` } : undefined;
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
  /** v0.8 Mock Bank contracts. Kept apart from `contracts` so setups without them keep working. */
  get bankContracts() {
    return {
      mthb: addr("MTHB_ADDRESS"),
      fileEscrow: addr("FILE_ESCROW_ADDRESS"),
    };
  },
  /**
   * Every FileEscrow deals live on, newest first. A replacement escrow (FileEscrow v2: split
   * rulings) continues the old one's numbering from FILE_ESCROW_FIRST_ID, so a deal id alone says
   * which contract holds it.
   */
  get fileEscrows(): { address: Address; firstId: number; splits: boolean }[] {
    const current = { address: addr("FILE_ESCROW_ADDRESS"), firstId: Number(process.env.FILE_ESCROW_FIRST_ID ?? 0), splits: Boolean(process.env.FILE_ESCROW_FIRST_ID) };
    const legacy = process.env.LEGACY_FILE_ESCROW_ADDRESS;
    return legacy ? [current, { address: getAddress(legacy), firstId: 0, splits: false }] : [current];
  },
  /** The escrow that holds deal `dealId`. New deals always go to bankContracts.fileEscrow. */
  fileEscrowOf(dealId: number | bigint): Address {
    const id = Number(dealId);
    return (this.fileEscrows.find((e) => id >= e.firstId) ?? this.fileEscrows[this.fileEscrows.length - 1]).address;
  },
  /** Whether deal `dealId`'s escrow can split a disputed milestone (FileEscrow v2). */
  fileEscrowSplits(dealId: number | bigint): boolean {
    const id = Number(dealId);
    return (this.fileEscrows.find((e) => id >= e.firstId) ?? { splits: false }).splits;
  },
  /** The on-chain token that mirrors `currency`, or null while it is not deployed (mCNY is optional). */
  bankToken(currency: "THB" | "CNY"): Address | null {
    const v = process.env[currency === "THB" ? "MTHB_ADDRESS" : "MCNY_ADDRESS"];
    return v ? getAddress(v) : null;
  },
  /** Neutral dispute resolver for every deal: never the buyer's or the contractor's own key. */
  get arbiter() {
    return addr("ARBITER_ADDRESS");
  },
  /** Blockscout instance used for event history when the RPC caps eth_getLogs ranges. */
  get blockscoutUrl(): string | null {
    if (process.env.BLOCKSCOUT_URL) return process.env.BLOCKSCOUT_URL;
    return this.chain.id === baseSepolia.id ? "https://base-sepolia.blockscout.com" : null;
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
      contractor: key("CONTRACTOR_PRIVATE_KEY"),
    };
  },
  /** The neutral arbiter's key: it only ever calls FileEscrow.resolve on disputed milestones. */
  get arbiterKey() {
    return key("ARBITER_PRIVATE_KEY");
  },
  /** The Mock Bank's hot key: the only one that may mint mTHB. Must not be the mTHB admin. */
  get bankKey() {
    return key("BANK_PRIVATE_KEY");
  },
};

/** Policy defaults for every new sandbox wallet (6-decimal mUSDC units). */
export const walletDefaults = {
  maxPerTx: 500_000_000n, // 500 mUSDC
  dailyLimit: 1_000_000_000n, // 1,000 mUSDC
  sessionDays: 7n,
  threshold: 1n,
  seed: 10_000_000_000n, // 10,000 mUSDC
  bankSeed: 1_000_000n, // 10,000 baht in the Mock Bank, in satang
};

/**
 * Policy defaults for wallets that settle in Mock Bank money, in the token's minor units
 * (satang / fen, 2 decimals). Roughly the same buying power in both currencies.
 */
export const bankWalletDefaults = {
  THB: { maxPerTx: 500_000n, dailyLimit: 2_000_000n }, // 5,000 / 20,000 baht
  CNY: { maxPerTx: 100_000n, dailyLimit: 400_000n }, // 1,000 / 4,000 yuan
} as const;

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
