// Deploys MockUSDC, MilestoneEscrow and AgentWallet, then applies the default policy.
//
//   npx hardhat keystore set BASE_SEPOLIA_RPC_URL
//   npx hardhat keystore set DEPLOYER_PRIVATE_KEY      # testnet-only key, becomes the wallet owner
//   AGENT_ADDRESS=0x.. APPROVERS=0x..,0x.. CONTRACTOR=0x.. \
//     npx hardhat run scripts/deploy.ts --network baseSepolia
//
// Writes deployments/<chainId>.json for the agent and web app.
import { mkdirSync, writeFileSync } from "node:fs";

import { network } from "hardhat";
import { getAddress, parseUnits } from "viem";

const env = (name: string, fallback?: string) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${name}`);
  return v;
};

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
const owner = deployer.account.address;

const agent = getAddress(env("AGENT_ADDRESS"));
const approvers = env("APPROVERS", owner)
  .split(",")
  .filter(Boolean)
  .map((a) => getAddress(a.trim()));
const contractor = process.env.CONTRACTOR ? getAddress(process.env.CONTRACTOR) : undefined;
const maxPerTx = parseUnits(env("MAX_PER_TX", "500"), 6);
const dailyLimit = parseUnits(env("DAILY_LIMIT", "1000"), 6);
const sessionDays = BigInt(env("SESSION_DAYS", "30"));
const threshold = BigInt(env("THRESHOLD", String(Math.min(2, approvers.length))));

const wait = async (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash });

const usdc = await viem.deployContract("MockUSDC");
const escrow = await viem.deployContract("MilestoneEscrow");
const wallet = await viem.deployContract("AgentWallet", [owner, usdc.address]);
console.log({ usdc: usdc.address, escrow: escrow.address, wallet: wallet.address });

const now = BigInt(Math.floor(Date.now() / 1000));
await wait(await usdc.write.mint([wallet.address, parseUnits("100000", 6)]));
await wait(await wallet.write.setEscrow([escrow.address, true]));
await wait(await wallet.write.setSession([agent, now + sessionDays * 86400n, maxPerTx, dailyLimit]));
for (const a of approvers) await wait(await wallet.write.setApprover([a, true]));
await wait(await wallet.write.setThreshold([threshold]));
if (contractor) await wait(await wallet.write.setRecipient([contractor, true]));

const chainId = await publicClient.getChainId();
mkdirSync("deployments", { recursive: true });
const out = {
  chainId,
  owner,
  agent,
  approvers,
  threshold: Number(threshold),
  contractor: contractor ?? null,
  maxPerTx: maxPerTx.toString(),
  dailyLimit: dailyLimit.toString(),
  contracts: { MockUSDC: usdc.address, MilestoneEscrow: escrow.address, AgentWallet: wallet.address },
};
writeFileSync(`deployments/${chainId}.json`, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote deployments/${chainId}.json`);
