// Checks fundJustInTime end to end: Mock Bank (the real database) + a local chain.
// Removes every bank row it created when done. Needs a local chain with the contracts on it:
//
//   cd contracts && npx hardhat node                                           (terminal 1)
//   cd contracts && BANK_ADDRESS=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 \
//     npx hardhat run scripts/deploy.ts --network localhost                     (terminal 2)
//   cd web && npm run funding-check
//
// Uses Hardhat's public test accounts: #0 owner (and mTHB admin), #1 agent, #2 contractor,
// #3 arbiter, #4 bank. Never point this at a real network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { type Address, type Hex, getAddress, toHex } from "viem";
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

const { agentWalletAbi, agentWalletFactoryAbi, fileEscrowAbi, mockTHBAbi } = await import("../src/lib/abis");
const { account, publicClient, roleAddresses, send } = await import("../src/lib/chain");
const { ATTACKER, config, walletDefaults } = await import("../src/lib/config");
const { db } = await import("../src/lib/db");
const { RESERVE_ID, ledgerTotals, seedSandbox, transfer } = await import("../src/lib/bank/ledger");
const { fileOfferMandate, fundJustInTime, ownerSignMandate } = await import("../src/lib/bank/funding");

const log = (step: string) => console.log(`✔ ${step}`);
const baht = (n: number) => BigInt(n) * 100n;
const pc = publicClient();
const { mthb, fileEscrow } = config.bankContracts;
const roles = roleAddresses();
const balanceOf = async (id: string) => (await db.bankAccount.findUniqueOrThrow({ where: { id } })).balance;
const supply = () => pc.readContract({ address: mthb, abi: mockTHBAbi, functionName: "totalSupply" });
const tokens = (a: Address) => pc.readContract({ address: mthb, abi: mockTHBAbi, functionName: "balanceOf", args: [a] });
const ok = (o: { status: string }) => assert.equal(o.status, "success", JSON.stringify(o));
const fundingIds: Hex[] = [];
const offer = (seller: Address, amounts: number[]) => ({
  seller,
  milestones: amounts.map((a) => ({ amount: baht(a), hasFile: true })),
  reviewPeriod: 3_600n,
  termsURI: "ipfs://terms-check",
});

// A sandbox wallet that pays in mTHB, with the file escrow allowed and the contractor allowlisted.
const created = await send("owner", {
  address: config.contracts.factory,
  abi: agentWalletFactoryAbi,
  functionName: "createWallet",
  args: [
    {
      owner: roles.owner,
      token: mthb,
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
ok(created);
const wallet = getAddress((created as { result: Address }).result);
ok(await send("owner", { address: wallet, abi: agentWalletAbi, functionName: "setFileEscrow", args: [fileEscrow, true] }));
const sandbox = await seedSandbox(wallet, baht(10_000));

const reserveBefore = await balanceOf(RESERVE_ID);
const supplyBefore = await supply();
const escrowBefore = await tokens(fileEscrow);

try {
  // 1. Happy path: 3,000 baht leaves the bank, becomes mTHB, and ends up locked in the escrow.
  const m1 = fileOfferMandate(offer(roles.contractor, [1_000, 2_000]), "logo + brand guide");
  const sig1 = await ownerSignMandate(wallet, m1);
  const r1 = await fundJustInTime(wallet, m1, sig1);
  fundingIds.push(r1.fundingId);
  assert.equal(r1.status, "FUNDED", JSON.stringify(r1, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  assert.deepEqual(
    r1.steps.map((s) => s.step),
    ["debit", "mint", "lock"],
  );
  assert.equal(await balanceOf(sandbox.id), baht(7_000));
  assert.equal(await balanceOf(RESERVE_ID), reserveBefore + baht(3_000));
  assert.equal((await tokens(fileEscrow)) - escrowBefore, baht(3_000));
  assert.equal(await tokens(wallet), 0n);
  const deal = await pc.readContract({ address: fileEscrow, abi: fileEscrowAbi, functionName: "getDeal", args: [BigInt(r1.dealId!)] });
  assert.equal(getAddress(deal.buyer), wallet);
  assert.equal(deal.status, 0); // Proposed: waits for the seller to accept, but the money is locked already
  log(`funded: 3,000 baht debited, minted and locked in escrow deal #${r1.dealId}`);

  // 2. Retrying the same mandate changes nothing.
  const again = await fundJustInTime(wallet, m1, sig1);
  assert.equal(again.status, "FUNDED");
  assert.equal(await balanceOf(sandbox.id), baht(7_000));
  assert.equal(await supply(), supplyBefore + baht(3_000));
  log("a retry of a funded deal neither debits nor mints again");

  // 3. Not enough baht: refused before anything moves.
  const m3 = fileOfferMandate(offer(roles.contractor, [8_000]), "too expensive");
  const r3 = await fundJustInTime(wallet, m3, await ownerSignMandate(wallet, m3));
  fundingIds.push(r3.fundingId);
  assert.equal(r3.status, "REJECTED");
  assert.equal(await balanceOf(sandbox.id), baht(7_000));
  assert.equal(await db.bankTransfer.count({ where: { idempotencyKey: { startsWith: `funding:${r3.fundingId}` } } }), 0);
  log("an offer the bank account cannot cover is refused with no money moved");

  // 4. Not the owner's signature: refused.
  const m4 = fileOfferMandate(offer(roles.contractor, [100]), "forged");
  const forged = await account("agent").signTypedData!({
    domain: { name: "AgentWallet", version: "1", chainId: config.chain.id, verifyingContract: wallet },
    types: {
      Mandate: [
        { name: "kind", type: "uint8" },
        { name: "target", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "index", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "reasonHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "Mandate",
    message: m4,
  });
  const r4 = await fundJustInTime(wallet, m4, forged);
  fundingIds.push(r4.fundingId);
  assert.equal(r4.status, "REJECTED");
  assert.equal(await balanceOf(sandbox.id), baht(7_000));
  log("a mandate the owner did not sign is refused");

  // 5. The lock fails for certain (seller not allowlisted) after the debit and the mint:
  //    revoke the mandate, burn the minted tokens, give the baht back.
  const m5 = fileOfferMandate(offer(ATTACKER, [1_000]), "pay a stranger");
  const sig5 = await ownerSignMandate(wallet, m5);
  const r5 = await fundJustInTime(wallet, m5, sig5);
  fundingIds.push(r5.fundingId);
  assert.equal(r5.status, "REFUNDED", JSON.stringify(r5, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  assert.deepEqual(
    r5.steps.map((s) => s.step),
    ["debit", "mint", "lock", "revoke", "redeem", "refund"],
  );
  assert.match(r5.error ?? "", /RecipientNotAllowed/);
  assert.equal(await balanceOf(sandbox.id), baht(7_000));
  assert.equal(await tokens(wallet), 0n);
  assert.equal(await supply(), supplyBefore + baht(3_000));
  assert.equal(await pc.readContract({ address: wallet, abi: agentWalletAbi, functionName: "mandateUsed", args: [r5.fundingId] }), true);
  log("a lock that fails for certain is undone: mandate revoked, mTHB burned, baht refunded");

  const r5again = await fundJustInTime(wallet, m5, sig5);
  assert.equal(r5again.status, "REFUNDED");
  assert.equal(r5again.steps.length, 0);
  assert.equal(await balanceOf(sandbox.id), baht(7_000));
  log("a retry of a refunded funding does nothing");

  // 6. Every mTHB minted here is backed by baht that went into the reserve.
  assert.equal((await balanceOf(RESERVE_ID)) - reserveBefore, (await supply()) - supplyBefore);
  log("reserve grew by exactly the mTHB still in circulation");
} finally {
  // The local chain is thrown away; put the reserve back and remove this run's bank rows.
  const extra = (await balanceOf(RESERVE_ID)) - reserveBefore;
  if (extra > 0n) {
    await transfer({ key: `check-${wallet}:unwind`, kind: "REFUND", fromId: RESERVE_ID, toId: sandbox.id, amount: extra });
  }
  await db.bankTransfer.deleteMany({
    where: { OR: [...fundingIds.map((id) => ({ idempotencyKey: { startsWith: `funding:${id}` } })), { toId: sandbox.id }] },
  });
  await db.bankAccount.delete({ where: { id: sandbox.id } });
  assert.equal(await balanceOf(RESERVE_ID), reserveBefore);
  const totals = await ledgerTotals();
  assert.equal(totals.balances, totals.deposits);
  console.log("✔ cleaned up; the ledger still balances");
  await db.$disconnect();
}
