// Deploys ChainAnchor to the chain the web app uses (CHAIN / RPC_URL / CHAIN_TOKEN), from the Mock
// Bank key, which is also its anchorer (the key the server sends anchors with). Prints the address
// to set as CHAIN_ANCHOR_ADDRESS.
//   npx tsx --env-file=.env.local scripts/deploy-chain-anchor.mts
import { readFileSync } from "node:fs";

import { type Hex, createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const artifact = JSON.parse(readFileSync(new URL("../../contracts/artifacts/contracts/device-chain/ChainAnchor.sol/ChainAnchor.json", import.meta.url), "utf8"));
const key = process.env.BANK_PRIVATE_KEY!.trim();
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const token = process.env.CHAIN_TOKEN?.trim();
const transport = http(process.env.RPC_URL, token ? { fetchOptions: { headers: { authorization: `Bearer ${token}` } } } : undefined);
const pc = createPublicClient({ transport });
const chain = defineChain({ id: await pc.getChainId(), name: "chain", nativeCurrency: { name: "Gas", symbol: "GAS", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL!] } } });
const wc = createWalletClient({ account, chain, transport });

const hash = await wc.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode as Hex, args: [account.address] });
const receipt = await pc.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed: ${hash}`);
console.log(`chain ${chain.id}, anchorer ${account.address}, tx ${hash}`);
console.log(`CHAIN_ANCHOR_ADDRESS=${receipt.contractAddress}`);
