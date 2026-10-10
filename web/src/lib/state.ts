import "server-only";

import { type Abi, type Address, type Hex, decodeEventLog, decodeFunctionData, formatUnits, getAddress, pad, toHex } from "viem";

import { agentWalletAbi, milestoneEscrowAbi, mockUSDCAbi } from "./abis";
import { type Role, ROLE_LABEL, publicClient, roleAddresses } from "./chain";
import { config, explorerAddress, explorerTx } from "./config";

export const MILESTONE_STATUS = ["Pending", "EvidenceSubmitted", "Released", "Disputed", "Refunded"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUS)[number];
export const PROPOSAL_KIND = ["Transfer", "ReleaseMilestone", "Call", "SetupDeal"] as const;

export const usd = (raw: bigint) => formatUnits(raw, 6);

/** Off-chain metadata is stored on-chain as a data: URI, so the chain is the only database. */
export function toDataUri(obj: unknown) {
  return `data:application/json,${encodeURIComponent(JSON.stringify(obj))}`;
}
export function fromDataUri<T>(uri: string): T | null {
  if (!uri.startsWith("data:application/json,")) return null;
  try {
    return JSON.parse(decodeURIComponent(uri.slice("data:application/json,".length))) as T;
  } catch {
    return null;
  }
}

export type DealTerms = {
  po?: string;
  title?: string;
  summary?: string;
  milestones?: { name: string; due?: string; acceptance?: string }[];
};
export type EvidenceDoc = { title?: string; text?: string; fileName?: string };

export type MilestoneView = {
  index: number;
  name: string;
  due: string | null;
  amount: string;
  amountRaw: string;
  status: MilestoneStatus;
  evidenceHash: Hex | null;
  evidence: EvidenceDoc | null;
};

export type DealView = {
  id: number;
  payer: Address;
  payee: Address;
  payeeLabel: string;
  arbiter: Address;
  total: string;
  funded: boolean;
  terms: DealTerms | null;
  milestones: MilestoneView[];
};

export type ProposalView = {
  id: number;
  kind: (typeof PROPOSAL_KIND)[number];
  proposer: string;
  reason: string;
  summary: string;
  amount: string | null;
  approvals: number;
  approvedBy: Role[];
  status: "open" | "executed" | "cancelled" | "expired" | "stale" | "superseded";
  expiresAt: number;
  /** ReleaseMilestone only. */
  release: { dealId: number; index: number } | null;
};

export type AuditEntry = {
  block: string;
  event: string;
  detail: string;
  txHash: Hex;
  url: string | null;
};

export type WalletState = Awaited<ReturnType<typeof readWallet>>;

const ZERO_HASH = `0x${"0".repeat(64)}`;

export function labelFor(address: string): string {
  const roles = roleAddresses();
  for (const [role, a] of Object.entries(roles)) {
    if (a.toLowerCase() === address.toLowerCase()) return ROLE_LABEL[role as Role];
  }
  if (address.toLowerCase() === config.contracts.escrow.toLowerCase()) return "MilestoneEscrow";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export async function readDeals(wallet: Address): Promise<DealView[]> {
  const pc = publicClient();
  const escrow = config.contracts.escrow;
  const [asPayer] = await pc.readContract({
    address: escrow,
    abi: milestoneEscrowAbi,
    functionName: "dealsOf",
    args: [wallet],
  });

  return Promise.all(
    asPayer.map(async (id) => {
      const d = await pc.readContract({ address: escrow, abi: milestoneEscrowAbi, functionName: "getDeal", args: [id] });
      const terms = fromDataUri<DealTerms>(d.termsURI);
      const milestones = await Promise.all(
        Array.from({ length: Number(d.milestoneCount) }, async (_, i) => {
          const m = await pc.readContract({
            address: escrow,
            abi: milestoneEscrowAbi,
            functionName: "getMilestone",
            args: [id, BigInt(i)],
          });
          const meta = terms?.milestones?.[i];
          return {
            index: i,
            name: meta?.name ?? `Milestone ${i + 1}`,
            due: meta?.due ?? null,
            amount: usd(m.amount),
            amountRaw: m.amount.toString(),
            status: MILESTONE_STATUS[m.status],
            evidenceHash: m.evidenceHash === ZERO_HASH ? null : m.evidenceHash,
            evidence: m.evidenceURI ? fromDataUri<EvidenceDoc>(m.evidenceURI) : null,
          } satisfies MilestoneView;
        }),
      );
      return {
        id: Number(id),
        payer: d.payer,
        payee: d.payee,
        payeeLabel: labelFor(d.payee),
        arbiter: d.arbiter,
        total: usd(d.total),
        funded: d.funded,
        terms,
        milestones,
      } satisfies DealView;
    }),
  );
}

function describeProposal(kind: number, target: Address, amount: bigint, index: bigint, data: Hex) {
  switch (kind) {
    case 0:
      return { summary: `Transfer ${usd(amount)} mUSDC to ${labelFor(target)}`, amount: usd(amount) };
    case 1:
      return { summary: `Release deal #${amount} milestone ${Number(index) + 1}`, amount: null };
    case 3: {
      try {
        const { args } = decodeFunctionData({ abi: milestoneEscrowAbi, data });
        const [payee, , , amounts] = args as unknown as [Address, Address, Address, readonly bigint[]];
        const total = amounts.reduce((a, b) => a + b, 0n);
        return {
          summary: `Create & fund deal: ${amounts.length} milestones, ${usd(total)} mUSDC to ${labelFor(payee)}`,
          amount: usd(total),
        };
      } catch {
        return { summary: "Create & fund deal", amount: null };
      }
    }
    default:
      return { summary: `Call ${labelFor(target)} (${data.slice(0, 10)})`, amount: null };
  }
}

export async function readProposals(wallet: Address, epoch: bigint): Promise<ProposalView[]> {
  const pc = publicClient();
  const count = await pc.readContract({ address: wallet, abi: agentWalletAbi, functionName: "proposalCount" });
  const roles = roleAddresses();
  const now = Math.floor(Date.now() / 1000);
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i)).reverse();

  return Promise.all(
    ids.map(async (id) => {
      const [p, byOwner] = await Promise.all([
        pc.readContract({ address: wallet, abi: agentWalletAbi, functionName: "getProposal", args: [id] }),
        pc.readContract({
          address: wallet,
          abi: agentWalletAbi,
          functionName: "hasApproved",
          args: [id, roles.owner],
        }),
      ]);
      const { summary, amount } = describeProposal(p.kind, p.target, p.amount, p.index, p.data);
      const status: ProposalView["status"] = p.executed
        ? "executed"
        : p.cancelled
          ? "cancelled"
          : now > Number(p.expiresAt)
            ? "expired"
            : p.approverEpoch !== epoch
              ? "stale"
              : "open";
      return {
        id: Number(id),
        kind: PROPOSAL_KIND[p.kind],
        proposer: labelFor(p.proposer),
        reason: p.reason,
        summary,
        amount,
        approvals: p.approvals,
        approvedBy: byOwner ? (["owner"] as const) : [],
        status,
        expiresAt: Number(p.expiresAt),
        release: p.kind === 1 ? { dealId: Number(p.amount), index: Number(p.index) } : null,
      } satisfies ProposalView;
    }),
  );
}

// Public RPCs cap eth_getLogs ranges (sepolia.base.org: 200 blocks). Recent history is read from
// the RPC in small chunks; anything older comes from Blockscout, which has no range limit.
const RPC_LOG_CHUNK = 200n;
const RPC_LOG_MAX_RANGE = 2_000n;
const BLOCKSCOUT_MAX_PAGES = 10;

type RawLog = { topics: [Hex, ...Hex[]]; data: Hex; blockNumber: bigint; logIndex: number; transactionHash: Hex };

async function rpcLogs(address: Address, from: bigint, to: bigint): Promise<RawLog[]> {
  const pc = publicClient();
  const ranges: [bigint, bigint][] = [];
  for (let f = from; f <= to; f += RPC_LOG_CHUNK) ranges.push([f, f + RPC_LOG_CHUNK - 1n > to ? to : f + RPC_LOG_CHUNK - 1n]);
  const logs = (await Promise.all(ranges.map(([fromBlock, toBlock]) => pc.getLogs({ address, fromBlock, toBlock })))).flat();
  return logs.map((l) => ({
    topics: l.topics as [Hex, ...Hex[]],
    data: l.data,
    blockNumber: l.blockNumber,
    logIndex: l.logIndex,
    transactionHash: l.transactionHash,
  }));
}

async function blockscoutLogs(base: string, address: Address, fromBlock: bigint, topic?: Hex): Promise<RawLog[]> {
  const out: RawLog[] = [];
  let params: Record<string, string> | null = topic ? { topic } : {};
  for (let page = 0; params && page < BLOCKSCOUT_MAX_PAGES; page++) {
    const res = await fetch(`${base}/api/v2/addresses/${address}/logs?${new URLSearchParams(params)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Blockscout ${res.status}`);
    const body = (await res.json()) as {
      items: { topics: (Hex | null)[]; data: Hex; block_number: number; index: number; transaction_hash: Hex }[];
      next_page_params: Record<string, string | number> | null;
    };
    for (const i of body.items) {
      if (BigInt(i.block_number) < fromBlock) return out; // newest first: older than the wallet means done
      out.push({
        topics: i.topics.filter((t): t is Hex => !!t) as [Hex, ...Hex[]],
        data: i.data,
        blockNumber: BigInt(i.block_number),
        logIndex: i.index,
        transactionHash: i.transaction_hash,
      });
    }
    params = body.next_page_params
      ? { ...(topic ? { topic } : {}), ...Object.fromEntries(Object.entries(body.next_page_params).map(([k, v]) => [k, String(v)])) }
      : null;
  }
  return out;
}

async function fetchLogs(address: Address, fromBlock: bigint, latest: bigint, topic?: Hex): Promise<RawLog[]> {
  const blockscout = config.blockscoutUrl;
  if (latest - fromBlock > RPC_LOG_MAX_RANGE && blockscout) return blockscoutLogs(blockscout, address, fromBlock, topic);
  const from = latest - fromBlock > RPC_LOG_MAX_RANGE ? latest - RPC_LOG_MAX_RANGE : fromBlock;
  return rpcLogs(address, from, latest);
}

function decodeLogs<const A extends Abi>(abi: A, logs: RawLog[]) {
  return logs.flatMap((l) => {
    try {
      const ev = decodeEventLog({ abi, topics: l.topics, data: l.data });
      return [{ ...l, eventName: ev.eventName as string, args: (ev.args ?? {}) as Record<string, unknown> }];
    } catch {
      return [];
    }
  });
}

/** Best effort: the audit log must never take the rest of the page down with it. */
export async function readAudit(wallet: Address, fromBlock: bigint, dealIds: number[]): Promise<AuditEntry[]> {
  try {
    const latest = await publicClient().getBlockNumber();
    const walletLogs = decodeLogs(agentWalletAbi, await fetchLogs(wallet, fromBlock, latest));
    const escrowLogs = (
      await Promise.all(
        dealIds.map(async (id) =>
          decodeLogs(milestoneEscrowAbi, await fetchLogs(config.contracts.escrow, fromBlock, latest, pad(toHex(id)))),
        ),
      )
    )
      .flat()
      .filter((l) => {
        const dealId = (l.args as { dealId?: bigint }).dealId;
        return dealId !== undefined && dealIds.includes(Number(dealId));
      });

    const fmt = (key: string, v: unknown): string => {
      if (typeof v === "bigint" && /amount|total|maxPerTx|dailyLimit/i.test(key)) return `${usd(v)} mUSDC`;
      if (typeof v === "bigint" && key === "expiresAt") return new Date(Number(v) * 1000).toISOString().slice(0, 10);
      if (typeof v === "bigint") return v.toString();
      if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) return labelFor(v);
      if (typeof v === "string" && v.length > 60) return `${v.slice(0, 57)}…`;
      return String(v);
    };

    const seen = new Set<string>();
    return [...walletLogs, ...escrowLogs]
      .filter((l) => {
        const k = `${l.transactionHash}:${l.logIndex}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((x, y) => (x.blockNumber === y.blockNumber ? y.logIndex - x.logIndex : Number(y.blockNumber - x.blockNumber)))
      .slice(0, 100)
      .map((l) => ({
        block: l.blockNumber.toString(),
        event: l.eventName,
        detail: Object.entries(l.args)
          .map(([k, v]) => `${k}=${fmt(k, v)}`)
          .join(" "),
        txHash: l.transactionHash,
        url: explorerTx(l.transactionHash),
      }));
  } catch (err) {
    console.error("audit log unavailable:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function readWallet(addressInput: string) {
  const wallet = getAddress(addressInput);
  const pc = publicClient();
  const roles = roleAddresses();
  // Loosely typed on purpose: a dozen parallel view calls whose return types are asserted below.
  const read = (functionName: string, args?: readonly unknown[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pc.readContract({ address: wallet, abi: agentWalletAbi, functionName, args } as any) as Promise<any>;

  const [owner, paused, session, remaining, threshold, epoch, createdAtBlock, balance, ownerApproves, contractorOk, escrowOk] =
    await Promise.all([
      read("owner") as Promise<Address>,
      read("paused") as Promise<boolean>,
      read("sessions", [roles.agent]) as Promise<[bigint, bigint, bigint]>,
      read("remainingToday", [roles.agent]) as Promise<bigint>,
      read("threshold") as Promise<bigint>,
      read("approverEpoch") as Promise<bigint>,
      read("createdAtBlock") as Promise<bigint>,
      pc.readContract({
        address: config.contracts.usdc,
        abi: mockUSDCAbi,
        functionName: "balanceOf",
        args: [wallet],
      }),
      read("isApprover", [roles.owner]) as Promise<boolean>,
      read("allowedRecipient", [roles.contractor]) as Promise<boolean>,
      read("allowedEscrow", [config.contracts.escrow]) as Promise<boolean>,
    ]);

  const [expiresAt, maxPerTx, dailyLimit] = session;
  const deals = await readDeals(wallet);
  const proposals = (await readProposals(wallet, epoch)).map((p) => {
    if (!p.release) return p;
    const m = deals.find((d) => d.id === p.release!.dealId)?.milestones[p.release.index];
    if (!m) return p;
    const summary = `Release ${m.name} (${Number(m.amount).toLocaleString("en-US")} mUSDC) on deal #${p.release.dealId}`;
    // Already paid or refunded by another path: approving would only revert.
    const done = m.status === "Released" || m.status === "Refunded";
    return { ...p, summary, status: p.status === "open" && done ? ("superseded" as const) : p.status };
  });

  return {
    address: wallet,
    explorer: explorerAddress(wallet),
    chain: config.chain.name,
    owner,
    paused,
    balance: usd(balance),
    createdAtBlock: createdAtBlock.toString(),
    session: {
      agent: roles.agent,
      active: Number(expiresAt) > Math.floor(Date.now() / 1000),
      expiresAt: Number(expiresAt),
      maxPerTx: usd(maxPerTx),
      dailyLimit: usd(dailyLimit),
      remainingToday: usd(remaining),
    },
    approvers: [{ role: "owner" as Role, address: roles.owner, active: ownerApproves }],
    threshold: Number(threshold),
    allowlist: {
      recipients: contractorOk ? [{ address: roles.contractor, label: "Contractor" }] : [],
      escrows: escrowOk ? [{ address: config.contracts.escrow, label: "MilestoneEscrow" }] : [],
    },
    roles,
    deals,
    proposals,
  };
}
