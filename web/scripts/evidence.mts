// Writes ../EVIDENCE.md: real transaction hashes from the live chain, grouped by what they prove,
// each linked to the public explorer. Reads only; run it again before submitting.
//   cd web && npx tsx --conditions=react-server --env-file=.env.local scripts/evidence.mts https://agentic-wallet-inky.vercel.app
import { writeFileSync } from "node:fs";

import { type AbiEvent, type Address, type Hex, decodeFunctionData, getAbiItem } from "viem";

const { publicClient } = await import("../src/lib/chain");
const { config } = await import("../src/lib/config");
const { agentWalletAbi, agentWalletFactoryAbi, fileEscrowAbi, mockTHBAbi } = await import("../src/lib/abis");

const site = (process.argv[2] ?? "https://agentic-wallet-inky.vercel.app").replace(/\/$/, "");
const pc = publicClient();
const fromBlock = BigInt(process.env.START_BLOCK ?? "0");
const head = await pc.getBlockNumber();
const c = config.contracts;
const b = config.bankContracts;

async function logs(address: Address, abi: readonly unknown[], name: string, limit = 6) {
  const event = getAbiItem({ abi: abi as never, name } as never) as AbiEvent;
  const out: { hash: Hex; block: bigint; args: Record<string, unknown> }[] = [];
  for (let start = fromBlock; start <= head; start += 10_000n) {
    const end = start + 9_999n < head ? start + 9_999n : head;
    const found = await pc.getLogs({ address, event, fromBlock: start, toBlock: end });
    for (const l of found) out.push({ hash: l.transactionHash!, block: l.blockNumber!, args: (l as { args?: Record<string, unknown> }).args ?? {} });
  }
  return out.slice(0, limit);
}

const tx = (h: Hex) => `[\`${h.slice(0, 10)}…${h.slice(-8)}\`](${site}/explorer/tx/${h})`;
const addr = (a: string) => `[\`${a}\`](${site}/explorer/address/${a})`;
const rows: string[] = [];
const section = (title: string, what: string, items: { hash: Hex; block: bigint; note: string }[]) => {
  rows.push(`### ${title}`, "", what, "", "| Tx | Block | What |", "|---|---|---|");
  for (const i of items) rows.push(`| ${tx(i.hash)} | #${i.block} | ${i.note} |`);
  if (items.length === 0) rows.push("| — | — | none yet |");
  rows.push("");
};

const created = await logs(c.factory, agentWalletFactoryAbi, "WalletCreated", 4);
section("Agent wallets created", "One transaction deploys a configured AgentWallet (owner, agent session key, caps, empty allowlist).", created.map((l) => ({ ...l, note: `wallet ${String(l.args.wallet)}` })));

const offers = await logs(b.fileEscrow, fileEscrowAbi, "OfferCreated", 6);
section(
  "Deals offered and money locked",
  "A buyer's offer locks the payment in FileEscrow in the same transaction; a seller's offer locks nothing until the buyer accepts and pays.",
  offers.map((l) => ({ ...l, note: `deal ${l.args.dealId} · total ${Number(l.args.total) / 100} mTHB · ${String(l.args.creator).toLowerCase() === String(l.args.buyer).toLowerCase() ? "buyer's offer" : "seller's offer"}` })),
);
const minted = await logs(b.mthb, mockTHBAbi, "Minted", 6).catch(() => []);
if (minted.length) section("Just-in-time funding (bank → mTHB)", "The Mock Bank mints exactly the debited amount into the buyer's wallet right before the lock.", minted.map((l) => ({ ...l, note: `${Number(l.args.amount) / 100} mTHB` })));

const redeemed = await logs(b.mthb, mockTHBAbi, "Redeemed", 6).catch(() => []);
if (redeemed.length) section("Settlement (mTHB → bank)", "Tokens paid out of escrow are burned and the same amount moves from the bank's reserve to the seller's (or refunded buyer's) account.", redeemed.map((l) => ({ ...l, note: `${Number(l.args.amount) / 100} mTHB burned` })));

for (const [name, what] of [
  ["OfferAccepted", "The counterparty accepts; for a seller's offer the buyer pays in here."],
  ["Delivered", "The seller anchors the sha256 of the delivered file (the work hash); the file stays encrypted off-chain."],
  ["Approved", "The buyer approves the work. Within the caps this is the agent's own Tier 2 action."],
  ["KeyReleased", "The seller's side publishes the key commitment; the buyer can now download the file."],
  ["Released", "The seller is paid from escrow."],
  ["OfferCancelled", "An offer withdrawn before acceptance."],
] as const) {
  const found = await logs(b.fileEscrow, fileEscrowAbi, name, 4).catch(() => []);
  if (found.length) section(name, what, found.map((l) => ({ ...l, note: `deal ${l.args.dealId}${l.args.index !== undefined ? ` · milestone ${Number(l.args.index) + 1}` : ""}` })));
}

// Attacks: agentTransfer to the attacker address, mined and reverted.
// Their hashes come from the Policy page's "Run attack" button (ATTACK_TXS=0x…,0x…).
const reverted: { hash: Hex; block: bigint; note: string }[] = [];
const attackHashes = (process.env.ATTACK_TXS ?? "").split(",").filter(Boolean) as Hex[];
for (const h of attackHashes) {
  const [t, r] = await Promise.all([pc.getTransaction({ hash: h }), pc.getTransactionReceipt({ hash: h })]);
  const call = decodeFunctionData({ abi: agentWalletAbi, data: t.input });
  reverted.push({ hash: h, block: r.blockNumber, note: `${call.functionName}(${(call.args ?? []).map(String).join(", ")}) from the agent key · **${r.status}**` });
}
section(
  "Attack refused on-chain",
  "The agent's own key calls `agentTransfer(0xBAd…Bad, 5000)`, skipping the AI and the policy engine. The contract reverts it (`RecipientNotAllowed`).",
  reverted,
);

const md = [
  "# Execution evidence",
  "",
  `Real transactions on the Agentic Wallet private chain (Hyperledger Besu, chain id ${config.chain.id}), collected at block #${head} on ${new Date().toISOString().slice(0, 10)}.`,
  `Every hash opens in the public explorer at ${site}/explorer (no sign-in), and can be checked independently over read-only JSON-RPC at \`${site}/api/rpc\`:`,
  "",
  "```bash",
  `cast receipt <tx hash> --rpc-url ${site}/api/rpc`,
  `curl -s ${site}/api/rpc -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["<tx hash>"]}'`,
  "```",
  "",
  "## Contracts",
  "",
  "| Contract | Address |",
  "|---|---|",
  `| AgentWalletFactory | ${addr(c.factory)} |`,
  `| FileEscrow | ${addr(b.fileEscrow)} |`,
  `| MockTHB (mTHB) | ${addr(b.mthb)} |`,
  `| MilestoneEscrow | ${addr(c.escrow)} |`,
  `| Arbiter (neutral) | ${addr(config.arbiter)} |`,
  "",
  "## Transactions",
  "",
  ...rows,
].join("\n");
writeFileSync(new URL("../../EVIDENCE.md", import.meta.url), md + "\n");
console.log(`EVIDENCE.md written (head #${head})`);
process.exit(0);
