// Adds MockCNY (mCNY) next to an existing deployment, for the Mock Bank's Chinese customers.
//   BESU_RPC_URL=… CHAIN_TOKEN=… DEPLOYER_PRIVATE_KEY=… BANK_ADDRESS=0xbank npx hardhat run scripts/deploy-mcny.ts --network besu
// Put the printed address in the web app as MCNY_ADDRESS.
import { network } from "hardhat";
import { getAddress } from "viem";

const { viem } = await network.create();
const [deployer] = await viem.getWalletClients();
if (!process.env.BANK_ADDRESS) throw new Error("Set BANK_ADDRESS (the Mock Bank's minting key)");
const bank = getAddress(process.env.BANK_ADDRESS);
const mcny = await viem.deployContract("MockCNY", [deployer.account.address, bank, 1_000_000n, 10_000_000n]);
console.log(`MCNY_ADDRESS=${mcny.address}`);
