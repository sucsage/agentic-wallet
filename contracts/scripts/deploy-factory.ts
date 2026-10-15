// Redeploys AgentWalletFactory only (e.g. after an AgentWallet fix), next to an existing deployment.
//   BESU_RPC_URL=… CHAIN_TOKEN=… DEPLOYER_PRIVATE_KEY=… npx hardhat run scripts/deploy-factory.ts --network besu
// Put the printed address in the web app as FACTORY_ADDRESS. Wallets made by the old factory keep
// their code; new wallets get the fixed AgentWallet.
import { network } from "hardhat";

const { viem } = await network.create();
const factory = await viem.deployContract("AgentWalletFactory");
console.log(`FACTORY_ADDRESS=${factory.address}`);
