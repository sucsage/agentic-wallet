// Deploys a replacement FileEscrow next to an existing deployment, continuing its deal numbers.
//   BESU_RPC_URL=… CHAIN_TOKEN=… DEPLOYER_PRIVATE_KEY=… OLD_FILE_ESCROW=0x… \
//     npx hardhat run scripts/deploy-file-escrow.ts --network besu
// Put the printed address in the web app as FILE_ESCROW_ADDRESS, the old one as
// LEGACY_FILE_ESCROW_ADDRESS and the first id as FILE_ESCROW_FIRST_ID: deals below it stay on the
// old escrow. Run with OLD_FILE_ESCROW unset for a fresh chain (numbering starts at 0).
import { network } from "hardhat";
import { getAddress } from "viem";

const { viem } = await network.create();
const old = process.env.OLD_FILE_ESCROW;
const firstId = old ? await (await viem.getContractAt("FileEscrow", getAddress(old))).read.dealCount() : 0n;
const escrow = await viem.deployContract("FileEscrow", [firstId]);
console.log(`FILE_ESCROW_ADDRESS=${escrow.address}`);
console.log(`FILE_ESCROW_FIRST_ID=${firstId}`);
