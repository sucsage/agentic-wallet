// Deploys the shared demo infrastructure: MockUSDC, MilestoneEscrow and AgentWalletFactory.
// Per-visitor wallets are created later by the web app through the factory.
//
//   npx hardhat keystore set BASE_SEPOLIA_RPC_URL
//   npx hardhat keystore set DEPLOYER_PRIVATE_KEY      # testnet-only key
//   FUND_ADDRESSES=0xagent,0xapproverA,0xapproverB,0xcontractor FUND_ETH=0.01 \
//     npx hardhat run scripts/deploy.ts --network baseSepolia
//
// FUND_ADDRESSES (optional) receive FUND_ETH each, so the demo role keys can pay gas.
// Writes deployments/<chainId>.json for the web app.
import { mkdirSync, writeFileSync } from "node:fs";

import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

const wait = async (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash });

const startBlock = await publicClient.getBlockNumber();
const usdc = await viem.deployContract("MockUSDC");
const escrow = await viem.deployContract("MilestoneEscrow");
const factory = await viem.deployContract("AgentWalletFactory");
console.log({ usdc: usdc.address, escrow: escrow.address, factory: factory.address });

const fundEth = parseEther(process.env.FUND_ETH ?? "0.01");
for (const raw of (process.env.FUND_ADDRESSES ?? "").split(",").filter(Boolean)) {
  const to = getAddress(raw.trim());
  await wait(await deployer.sendTransaction({ to, value: fundEth }));
  console.log(`Funded ${to} with ${process.env.FUND_ETH ?? "0.01"} ETH`);
}

const chainId = await publicClient.getChainId();
mkdirSync("deployments", { recursive: true });
const out = {
  chainId,
  startBlock: startBlock.toString(),
  contracts: { MockUSDC: usdc.address, MilestoneEscrow: escrow.address, AgentWalletFactory: factory.address },
};
writeFileSync(`deployments/${chainId}.json`, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote deployments/${chainId}.json`);
