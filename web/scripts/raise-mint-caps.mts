// Raises the Mock Bank tokens' mint caps so one deal can lock up to 100,000 baht (20,000 yuan),
// matching the agent's per-transaction range (src/lib/send-limits.ts). Dry run by default:
//   npx tsx --conditions=react-server --env-file=.env.local scripts/raise-mint-caps.mts          # shows who can set them
//   npx tsx --conditions=react-server --env-file=.env.local scripts/raise-mint-caps.mts apply    # sends setMintCaps
import { mockTHBAbi } from "../src/lib/abis";
import { type Role, account, publicClient, send } from "../src/lib/chain";

const c = publicClient();
const ADMIN = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
// Minor units (2 decimals): per mint / per day.
const WANT = { THB: [10_000_000n, 100_000_000n], CNY: [2_000_000n, 20_000_000n] } as const;

for (const [cur, addr] of [["THB", process.env.MTHB_ADDRESS], ["CNY", process.env.MCNY_ADDRESS]] as const) {
  if (!addr) continue;
  const token = addr as `0x${string}`;
  const read = () =>
    Promise.all([c.readContract({ address: token, abi: mockTHBAbi, functionName: "maxMintPerTx" }), c.readContract({ address: token, abi: mockTHBAbi, functionName: "dailyMintCap" })]);
  let admin: Role | null = null;
  for (const r of ["owner", "bank"] as Role[]) {
    if (await c.readContract({ address: token, abi: mockTHBAbi, functionName: "hasRole", args: [ADMIN, account(r).address] })) {
      admin = r;
      break;
    }
  }
  const [perTx, daily] = await read();
  console.log(`${cur}: per mint ${Number(perTx) / 100}, per day ${Number(daily) / 100}; admin key: ${admin ?? "none"}`);
  if (!admin || process.argv[2] !== "apply") continue;
  const out = await send(admin, { address: token, abi: mockTHBAbi, functionName: "setMintCaps", args: [...WANT[cur]] });
  const [x, y] = await read();
  console.log(`${cur}: ${out.status} → per mint ${Number(x) / 100}, per day ${Number(y) / 100}`);
}
process.exit(0);
