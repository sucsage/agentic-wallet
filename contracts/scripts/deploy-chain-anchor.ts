// Deploys ChainAnchor (public timestamps for the desktop app's device chains).
//   BESU_RPC_URL=… CHAIN_TOKEN=… DEPLOYER_PRIVATE_KEY=… ANCHORER=0x<the Mock Bank address> \
//     npx hardhat run scripts/deploy-chain-anchor.ts --network besu
// The anchorer is the server key that sends anchors (the web app uses the Mock Bank key, which the
// chain's account permissioning already allows). Put the printed address in the web app as
// CHAIN_ANCHOR_ADDRESS.
import { network } from "hardhat";
import { getAddress } from "viem";

const anchorer = process.env.ANCHORER;
if (!anchorer) throw new Error("Set ANCHORER to the server address that will send anchors");
const { viem } = await network.create();
const anchor = await viem.deployContract("ChainAnchor", [getAddress(anchorer)]);
console.log(`CHAIN_ANCHOR_ADDRESS=${anchor.address}`);
