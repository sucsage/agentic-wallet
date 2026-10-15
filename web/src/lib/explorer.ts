import "server-only";

import {
  type Abi,
  type Address,
  type Hex,
  decodeEventLog,
  decodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  isHash,
} from "viem";

import { agentWalletAbi, agentWalletFactoryAbi, fileEscrowAbi, milestoneEscrowAbi, mockTHBAbi, mockUSDCAbi } from "./abis";
import { publicClient, roleAddresses } from "./chain";
import { config } from "./config";
import { db } from "./db";

/**
 * The admin explorer: what a reviewer needs to verify transaction hashes on a chain that has no
 * public explorer. Reads go straight to the node; inputs and events are decoded with the ABIs of
 * the contracts we deploy, and known addresses get a label.
 */

const ABIS: { name: string; abi: Abi }[] = [
  { name: "AgentWallet", abi: agentWalletAbi as Abi },
  { name: "AgentWalletFactory", abi: agentWalletFactoryAbi as Abi },
  { name: "FileEscrow", abi: fileEscrowAbi as Abi },
  { name: "MilestoneEscrow", abi: milestoneEscrowAbi as Abi },
  { name: "MockTHB", abi: mockTHBAbi as Abi },
  { name: "MockUSDC", abi: mockUSDCAbi as Abi },
];

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

/** Names for the addresses this system knows: server roles, its contracts, user wallets. */
export async function addressLabels(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const roles = roleAddresses();
  m.set(roles.owner.toLowerCase(), "Owner key (server)");
  m.set(roles.agent.toLowerCase(), "AI agent key");
  m.set(roles.contractor.toLowerCase(), "Demo contractor");
  m.set(config.arbiter.toLowerCase(), "Arbiter");
  const c = config.contracts;
  m.set(c.usdc.toLowerCase(), "MockUSDC");
  m.set(c.escrow.toLowerCase(), "MilestoneEscrow");
  m.set(c.factory.toLowerCase(), "AgentWalletFactory");
  if (process.env.MTHB_ADDRESS) m.set(config.bankContracts.mthb.toLowerCase(), "MockTHB (mTHB)");
  if (process.env.MCNY_ADDRESS) m.set(getAddress(process.env.MCNY_ADDRESS).toLowerCase(), "MockCNY (mCNY)");
  if (process.env.FILE_ESCROW_ADDRESS) m.set(config.bankContracts.fileEscrow.toLowerCase(), "FileEscrow");
  if (process.env.BANK_PRIVATE_KEY) {
    const { account } = await import("./chain");
    m.set(account("bank").address.toLowerCase(), "Mock Bank key");
  }
  // Reviewers see the bank username (a pseudonym), not the person's display name.
  const wallets = await db.userWallet.findMany({ include: { user: { select: { bankCustomer: { select: { username: true } } } } } });
  for (const w of wallets) m.set(w.walletAddress.toLowerCase(), `Agent wallet · @${w.user.bankCustomer?.username ?? "user"}`);
  return m;
}

function decodeInput(data: Hex): { contract: string; fn: string; args: string } | null {
  if (!data || data === "0x") return null;
  for (const { name, abi } of ABIS) {
    try {
      const d = decodeFunctionData({ abi, data });
      return { contract: name, fn: d.functionName, args: json(d.args ?? []) };
    } catch {
      // not this ABI
    }
  }
  return { contract: "?", fn: data.slice(0, 10), args: "" };
}

function decodeLog(log: { address: Address; data: Hex; topics: [] | [Hex, ...Hex[]] }) {
  for (const { name, abi } of ABIS) {
    try {
      const e = decodeEventLog({ abi, data: log.data, topics: log.topics });
      return { contract: name, event: e.eventName ?? "", args: json(e.args ?? {}) };
    } catch {
      // not this ABI
    }
  }
  return { contract: "?", event: log.topics[0]?.slice(0, 10) ?? "", args: "" };
}

/** The newest blocks that hold transactions (empty blocks every 2 s are skipped), up to `count`. */
export async function latestBlocks(count = 15, scan = 400) {
  const pc = publicClient();
  const head = await pc.getBlockNumber({ cacheTime: 0 });
  const numbers = Array.from({ length: Math.min(scan, Number(head) + 1) }, (_, i) => head - BigInt(i));
  const scanned = [];
  for (let i = 0; i < numbers.length; i += 50) {
    scanned.push(...(await Promise.all(numbers.slice(i, i + 50).map((n) => pc.getBlock({ blockNumber: n, includeTransactions: true })))));
  }
  const blocks = scanned.filter((b) => b.transactions.length > 0).slice(0, count);
  return {
    chain: { id: config.chain.id, name: config.chain.name, head: head.toString() },
    blocks: blocks.map((b) => ({
      number: b.number.toString(),
      time: Number(b.timestamp),
      txs: b.transactions.map((t) => ({
        hash: t.hash,
        from: t.from,
        to: t.to,
        call: decodeInput(t.input),
      })),
    })),
  };
}

export async function txDetail(hash: string) {
  if (!isHash(hash)) return null;
  const pc = publicClient();
  const [tx, receipt] = await Promise.all([
    pc.getTransaction({ hash: hash as Hex }).catch(() => null),
    pc.getTransactionReceipt({ hash: hash as Hex }).catch(() => null),
  ]);
  if (!tx) return null;
  const block = tx.blockNumber !== null ? await pc.getBlock({ blockNumber: tx.blockNumber }) : null;
  return {
    hash: tx.hash,
    status: receipt?.status ?? "pending",
    block: tx.blockNumber?.toString() ?? null,
    time: block ? Number(block.timestamp) : null,
    from: tx.from,
    to: tx.to,
    created: receipt?.contractAddress ?? null,
    gasUsed: receipt?.gasUsed.toString() ?? null,
    call: decodeInput(tx.input),
    events: (receipt?.logs ?? []).map((l) => ({ address: l.address, ...decodeLog(l) })),
  };
}

export async function addressDetail(raw: string, lookback = 2000n) {
  if (!isAddress(raw)) return null;
  const address = getAddress(raw);
  const pc = publicClient();
  const head = await pc.getBlockNumber({ cacheTime: 0 });
  const fromBlock = head > lookback ? head - lookback : 0n;
  const [code, logs] = await Promise.all([pc.getCode({ address }), pc.getLogs({ address, fromBlock, toBlock: head })]);
  let mthb: string | null = null;
  if (process.env.MTHB_ADDRESS) {
    const bal = await pc.readContract({ address: config.bankContracts.mthb, abi: mockTHBAbi, functionName: "balanceOf", args: [address] });
    mthb = formatUnits(bal, 2);
  }
  return {
    address,
    contract: Boolean(code && code !== "0x"),
    mthb,
    events: logs
      .slice(-50)
      .reverse()
      .map((l) => ({ block: l.blockNumber?.toString() ?? "", tx: l.transactionHash, ...decodeLog(l) })),
  };
}
