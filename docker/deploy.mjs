// One-shot deploy for the compose stack. Reads the root .env (injected by compose), derives the
// addresses it needs from the role keys, runs contracts/scripts/deploy.ts against the `chain`
// container, and writes the resulting addresses to /shared/contracts.env for the web container.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { privateKeyToAddress } from "viem/accounts";

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k} in the root .env`);
  return v;
};
const addr = (k) => privateKeyToAddress(need(k));

const bank = addr("BANK_PRIVATE_KEY");
const arbiter = addr("ARBITER_PRIVATE_KEY");
const fund = [addr("AGENT_PRIVATE_KEY"), addr("CONTRACTOR_PRIVATE_KEY"), bank, arbiter].join(",");

const run = spawnSync("npx", ["hardhat", "run", "scripts/deploy.ts", "--network", "localhost"], {
  stdio: "inherit",
  env: { ...process.env, LOCALHOST_RPC_URL: need("RPC_URL"), BANK_ADDRESS: bank, FUND_ADDRESSES: fund },
});
if (run.status !== 0) process.exit(run.status ?? 1);

const { contracts, startBlock } = JSON.parse(readFileSync("deployments/31337.json", "utf8"));
const out = {
  USDC_ADDRESS: contracts.MockUSDC,
  ESCROW_ADDRESS: contracts.MilestoneEscrow,
  FACTORY_ADDRESS: contracts.AgentWalletFactory,
  MTHB_ADDRESS: contracts.MockTHB,
  MCNY_ADDRESS: contracts.MockCNY,
  FILE_ESCROW_ADDRESS: contracts.FileEscrow,
  ARBITER_ADDRESS: arbiter,
  START_BLOCK: startBlock,
};
mkdirSync("/shared", { recursive: true });
writeFileSync("/shared/contracts.env", Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
console.log("Wrote /shared/contracts.env");
