// Security checks for the funding path (owner: @NawaratKhem). They need a throwaway database AND a local chain:
//   cd contracts && npx hardhat node
//   cd contracts && BANK_ADDRESS=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 npx hardhat run scripts/deploy.ts --network localhost
//   (from web/, with a throwaway DATABASE_URL/DIRECT_URL) npx tsx --conditions=react-server scripts/security/funding-security.test.mts
// Uses Hardhat's public test accounts like scripts/funding-check.mts. Never point this at a real network or a shared database.
// Tests named "KNOWN GAP" pass today and record unsafe behaviour from docs/security; flip them when the code is fixed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { type Address, getAddress, toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
const testKey = (i: number) => toHex(mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: i }).getHdKey().privateKey!);
const deployment = JSON.parse(readFileSync("../contracts/deployments/31337.json", "utf8"));

Object.assign(process.env, {
  CHAIN: "hardhat",
  RPC_URL: "http://127.0.0.1:8545",
  USDC_ADDRESS: deployment.contracts.MockUSDC,
  ESCROW_ADDRESS: deployment.contracts.MilestoneEscrow,
  FACTORY_ADDRESS: deployment.contracts.AgentWalletFactory,
  MTHB_ADDRESS: deployment.contracts.MockTHB,
  FILE_ESCROW_ADDRESS: deployment.contracts.FileEscrow,
  ARBITER_ADDRESS: mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: 3 }).address,
  OWNER_PRIVATE_KEY: testKey(0),
  AGENT_PRIVATE_KEY: testKey(1),
  CONTRACTOR_PRIVATE_KEY: testKey(2),
  BANK_PRIVATE_KEY: testKey(4),
});

const { agentWalletAbi, agentWalletFactoryAbi, fileEscrowAbi } = await import("../../src/lib/abis");
const { publicClient, roleAddresses, send } = await import("../../src/lib/chain");
const { config, walletDefaults } = await import("../../src/lib/config");
const { db } = await import("../../src/lib/db");
const { seedSandbox } = await import("../../src/lib/bank/ledger");
const { approveDraft, createDraft } = await import("../../src/lib/bank/drafts");

const baht = (n: number) => BigInt(n) * 100n;
const pc = publicClient();
const roles = roleAddresses();
const run = `fs${Date.now().toString(36)}`;

/** A fresh mTHB wallet with a bank account holding 10,000 baht, the contractor allowlisted, and a user to own drafts. */
async function newSandbox() {
  const created = await send("owner", {
    address: config.contracts.factory,
    abi: agentWalletFactoryAbi,
    functionName: "createWallet",
    args: [
      {
        owner: roles.owner,
        token: config.bankContracts.mthb,
        agent: roles.agent,
        sessionExpiresAt: (await pc.getBlock()).timestamp + 86_400n,
        maxPerTx: baht(500),
        dailyLimit: baht(1_000),
        approvers: [roles.owner],
        threshold: walletDefaults.threshold,
        recipients: [roles.contractor],
        escrows: [],
      },
      0n,
    ],
  });
  assert.equal(created.status, "success");
  const wallet = getAddress((created as { result: Address }).result);
  await send("owner", { address: wallet, abi: agentWalletAbi, functionName: "setFileEscrow", args: [config.bankContracts.fileEscrow, true] });
  const account = await seedSandbox(wallet, baht(10_000));
  const user = await db.user.create({ data: { id: `${run}-${Math.random().toString(36).slice(2, 8)}`, name: "Funding test", email: `${run}-${Math.random().toString(36).slice(2, 8)}@example.test` } });
  return { wallet, account, user };
}

const dealCount = () => pc.readContract({ address: config.bankContracts.fileEscrow, abi: fileEscrowAbi, functionName: "dealCount" });
const balanceOf = async (id: string) => (await db.bankAccount.findUniqueOrThrow({ where: { id } })).balance;
const newDraft = (userId: string, wallet: Address, amount: string) =>
  createDraft(userId, wallet, {
    seller: roles.contractor,
    title: "Logo",
    summary: "One logo",
    reviewHours: 1,
    milestones: [{ name: "Final logo", amount, hasFile: true, due: null, acceptance: "SVG file" }],
  });

describe("Funding a deal from the bank", () => {
  it("one approval debits once and locks once (baseline)", async () => {
    const { wallet, account, user } = await newSandbox();
    const draft = await newDraft(user.id, wallet, "1000");
    const before = await dealCount();
    const { funding } = await approveDraft(user.id, wallet, draft.id);
    assert.equal(funding.status, "FUNDED");
    assert.equal((await dealCount()) - before, 1n);
    assert.equal(await balanceOf(account.id), baht(9_000));
  });

  it("KNOWN GAP (DB-01): simultaneous approvals of one draft can lock and debit it more than once", async () => {
    // The race depends on timing, so try several fresh drafts with three overlapping approvals each.
    let worst = { round: -1, locks: 0, debited: 0n };
    for (let round = 0; round < 12 && worst.locks < 2; round++) {
      const { wallet, account, user } = await newSandbox();
      const draft = await newDraft(user.id, wallet, "1000");
      const before = await dealCount();
      await Promise.allSettled([1, 2, 3].map(() => approveDraft(user.id, wallet, draft.id)));
      const locks = Number((await dealCount()) - before);
      const debited = baht(10_000) - (await balanceOf(account.id));
      if (locks > worst.locks) worst = { round, locks, debited };
    }
    console.log(`      worst case in up to 12 rounds of 3 parallel approvals: ${worst.locks} escrow deals, ${worst.debited / 100n} baht debited (approved: 1,000)`);
    assert.ok(worst.locks >= 2, "never locked twice in 12 rounds: DB-01 did not reproduce here (timing dependent) or is fixed");
    assert.ok(worst.debited >= baht(2_000));
  });

  it("KNOWN GAP (AW-L-01): a bank account the customer has unlinked can still be debited", async () => {
    const { wallet, account, user } = await newSandbox();
    await db.bankAccount.update({ where: { id: account.id }, data: { linkedAt: null } }); // consent withdrawn
    assert.equal((await db.bankAccount.findUniqueOrThrow({ where: { id: account.id } })).linkedAt, null);
    const draft = await newDraft(user.id, wallet, "1000");
    const { funding } = await approveDraft(user.id, wallet, draft.id);
    assert.equal(funding.status, "FUNDED", "funding refused for an unlinked account: AW-L-01 may be fixed, flip this test");
    assert.equal(await balanceOf(account.id), baht(9_000));
  });

  it("an offer larger than the balance is refused and moves no money", async () => {
    const { wallet, account, user } = await newSandbox();
    const draft = await newDraft(user.id, wallet, "50000");
    const before = await dealCount();
    const { funding } = await approveDraft(user.id, wallet, draft.id);
    assert.equal(funding.status, "REJECTED");
    assert.equal(await dealCount(), before);
    assert.equal(await balanceOf(account.id), baht(10_000));
  });

  it("the approval of a draft that belongs to another user is refused", async () => {
    const { wallet, user } = await newSandbox();
    const stranger = await db.user.create({ data: { id: `${run}-x`, name: "Other", email: `${run}-x@example.test` } });
    const draft = await newDraft(user.id, wallet, "100");
    await assert.rejects(approveDraft(stranger.id, wallet, draft.id), /Draft not found/);
  });
});

await db.$disconnect();
