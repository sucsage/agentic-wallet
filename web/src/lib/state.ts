import "server-only";

import { type Address, type Hex, decodeFunctionData, formatUnits, getAddress } from "viem";

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
      const [p, a, b] = await Promise.all([
        pc.readContract({ address: wallet, abi: agentWalletAbi, functionName: "getProposal", args: [id] }),
        pc.readContract({
          address: wallet,
          abi: agentWalletAbi,
          functionName: "hasApproved",
          args: [id, roles.approverA],
        }),
        pc.readContract({
          address: wallet,
          abi: agentWalletAbi,
          functionName: "hasApproved",
          args: [id, roles.approverB],
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
        approvedBy: [...(a ? (["approverA"] as const) : []), ...(b ? (["approverB"] as const) : [])],
        status,
        expiresAt: Number(p.expiresAt),
        release: p.kind === 1 ? { dealId: Number(p.amount), index: Number(p.index) } : null,
      } satisfies ProposalView;
    }),
  );
}

const LOG_CHUNK = 9_000n;
const LOG_WINDOW = 90_000n;

export async function readAudit(wallet: Address, fromBlock: bigint, dealIds: number[]): Promise<AuditEntry[]> {
  const pc = publicClient();
  const latest = await pc.getBlockNumber();
  const start = fromBlock > latest - LOG_WINDOW ? fromBlock : latest - LOG_WINDOW;
  const ranges: [bigint, bigint][] = [];
  for (let f = start; f <= latest; f += LOG_CHUNK) {
    ranges.push([f, f + LOG_CHUNK - 1n > latest ? latest : f + LOG_CHUNK - 1n]);
  }

  const walletLogs = (
    await Promise.all(
      ranges.map(([from, to]) =>
        pc.getContractEvents({ address: wallet, abi: agentWalletAbi, fromBlock: from, toBlock: to }),
      ),
    )
  ).flat();
  const escrowLogs = dealIds.length
    ? (
        await Promise.all(
          ranges.map(([from, to]) =>
            pc.getContractEvents({
              address: config.contracts.escrow,
              abi: milestoneEscrowAbi,
              fromBlock: from,
              toBlock: to,
            }),
          ),
        )
      )
        .flat()
        .filter((l) => {
          const args = l.args as { dealId?: bigint };
          return args.dealId !== undefined && dealIds.includes(Number(args.dealId));
        })
    : [];

  const fmt = (key: string, v: unknown): string => {
    if (typeof v === "bigint" && /amount|total|maxPerTx|dailyLimit/i.test(key)) return `${usd(v)} mUSDC`;
    if (typeof v === "bigint" && key === "expiresAt") return new Date(Number(v) * 1000).toISOString().slice(0, 10);
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) return labelFor(v);
    if (typeof v === "string" && v.length > 60) return `${v.slice(0, 57)}…`;
    return String(v);
  };

  return [...walletLogs, ...escrowLogs]
    .sort((x, y) =>
      x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : Number(x.blockNumber - y.blockNumber),
    )
    .reverse()
    .slice(0, 100)
    .map((l) => ({
      block: l.blockNumber.toString(),
      event: l.eventName,
      detail: Object.entries((l.args ?? {}) as Record<string, unknown>)
        .map(([k, v]) => `${k}=${fmt(k, v)}`)
        .join(" "),
      txHash: l.transactionHash,
      url: explorerTx(l.transactionHash),
    }));
}

export async function readWallet(addressInput: string) {
  const wallet = getAddress(addressInput);
  const pc = publicClient();
  const roles = roleAddresses();
  // Loosely typed on purpose: a dozen parallel view calls whose return types are asserted below.
  const read = (functionName: string, args?: readonly unknown[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pc.readContract({ address: wallet, abi: agentWalletAbi, functionName, args } as any) as Promise<any>;

  const [owner, paused, session, remaining, threshold, epoch, createdAtBlock, balance, isA, isB, contractorOk, escrowOk] =
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
      read("isApprover", [roles.approverA]) as Promise<boolean>,
      read("isApprover", [roles.approverB]) as Promise<boolean>,
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
    approvers: [
      { role: "approverA" as Role, address: roles.approverA, active: isA },
      { role: "approverB" as Role, address: roles.approverB, active: isB },
    ],
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
