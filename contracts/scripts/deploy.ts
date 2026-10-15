// Deploys the shared demo infrastructure: MockUSDC, MilestoneEscrow, AgentWalletFactory, and the
// v0.8 Mock Bank pieces: MockTHB (mTHB) and FileEscrow.
// Per-visitor wallets are created later by the web app through the factory.
//
//   npx hardhat keystore set BASE_SEPOLIA_RPC_URL
//   npx hardhat keystore set DEPLOYER_PRIVATE_KEY      # testnet-only key
//   BANK_ADDRESS=0xbank FUND_ADDRESSES=0xagent,0xcontractor,0xbank FUND_ETH=0.01 \
//     npx hardhat run scripts/deploy.ts --network baseSepolia
//
// BANK_ADDRESS is the Mock Bank server's hot key: the only one allowed to mint mTHB. The deployer
// becomes the mTHB admin, so the two must differ.
// FUND_ADDRESSES (optional) receive FUND_ETH each, so the demo role keys can pay gas.
// Writes deployments/<chainId>.json for the web app.
import { mkdirSync, writeFileSync } from "node:fs";

import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

// mTHB mint caps in satang: 10,000 baht per mint, 100,000 baht per day.
const MAX_MINT_PER_TX = 1_000_000n;
const DAILY_MINT_CAP = 10_000_000n;

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

if (!process.env.BANK_ADDRESS) throw new Error("Set BANK_ADDRESS (the Mock Bank's minting key)");
const bank = getAddress(process.env.BANK_ADDRESS);

const wait = async (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash });

const startBlock = await publicClient.getBlockNumber();
const usdc = await viem.deployContract("MockUSDC");
const escrow = await viem.deployContract("MilestoneEscrow");
const factory = await viem.deployContract("AgentWalletFactory");
const mthb = await viem.deployContract("MockTHB", [deployer.account.address, bank, MAX_MINT_PER_TX, DAILY_MINT_CAP]);
const fileEscrow = await viem.deployContract("FileEscrow");
// Fen, like satang: the same caps in minor units.
const mcny = await viem.deployContract("MockCNY", [deployer.account.address, bank, MAX_MINT_PER_TX, DAILY_MINT_CAP]);
console.log({
  usdc: usdc.address,
  escrow: escrow.address,
  factory: factory.address,
  mthb: mthb.address,
  mcny: mcny.address,
  fileEscrow: fileEscrow.address,
});

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
  contracts: {
    MockUSDC: usdc.address,
    MilestoneEscrow: escrow.address,
    AgentWalletFactory: factory.address,
    MockTHB: mthb.address,
    MockCNY: mcny.address,
    FileEscrow: fileEscrow.address,
  },
  bank,
};
writeFileSync(`deployments/${chainId}.json`, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote deployments/${chainId}.json`);
