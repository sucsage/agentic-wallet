// Lets every agent wallet that uses the current FileEscrow also use a replacement (FileEscrow v2).
//   cd web && NEW_FILE_ESCROW=0x… npx tsx --conditions=react-server --env-file=.env.local scripts/allow-file-escrow.mts
// Run it before pointing FILE_ESCROW_ADDRESS at the new escrow. Safe to run twice: wallets that
// already allow it are skipped. Wallets created later get the current escrow from createWallet.
import { getAddress } from "viem";

const { db } = await import("../src/lib/db");
const { publicClient, send } = await import("../src/lib/chain");
const { agentWalletAbi } = await import("../src/lib/abis");

const next = getAddress(process.env.NEW_FILE_ESCROW ?? "");
const old = getAddress(process.env.LEGACY_FILE_ESCROW_ADDRESS ?? process.env.FILE_ESCROW_ADDRESS ?? "");
const wallets = await db.wallet.findMany({ select: { address: true } });
let done = 0;
for (const { address } of wallets) {
  const wallet = getAddress(address);
  const read = (escrow: `0x${string}`) =>
    publicClient().readContract({ address: wallet, abi: agentWalletAbi, functionName: "allowedFileEscrow", args: [escrow] }).catch(() => null);
  const [usesOld, hasNext] = await Promise.all([read(old), read(next)]);
  if (!usesOld || hasNext) continue; // not a bank wallet, or already allowed
  const out = await send("owner", { address: wallet, abi: agentWalletAbi, functionName: "setFileEscrow", args: [next, true] });
  console.log(wallet, out.status);
  if (out.status === "success") done++;
}
console.log(`allowed on ${done} wallet(s) of ${wallets.length}`);
process.exit(0);
