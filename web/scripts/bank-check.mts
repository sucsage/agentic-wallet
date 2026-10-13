// Checks the Mock Bank ledger against the real database, then removes everything it created.
//   npm run bank-check
import assert from "node:assert/strict";

import { db } from "../src/lib/db";
import {
  IdempotencyConflict,
  InsufficientFunds,
  RESERVE_ID,
  ledgerTotals,
  openAccount,
  reserveAccount,
  seedSandbox,
  transfer,
} from "../src/lib/bank/ledger";

const run = `check-${Date.now()}`;
const key = (name: string) => `${run}:${name}`;
const log = (step: string) => console.log(`✔ ${step}`);
const balanceOf = async (id: string) => (await db.bankAccount.findUniqueOrThrow({ where: { id } })).balance;

try {
  const reserve = await reserveAccount();
  const reserveBefore = reserve.balance;
  const buyer = await openAccount(`${run}-buyer`, "check buyer");
  assert.equal((await openAccount(`${run}-buyer`, "again")).id, buyer.id);
  log("one account per address, opening it again returns the same one");

  const deposit = { key: key("deposit"), kind: "DEPOSIT" as const, fromId: null, toId: buyer.id, amount: 500_000n };
  const first = await transfer(deposit);
  const retry = await transfer(deposit);
  assert.equal(retry.id, first.id);
  assert.equal(await balanceOf(buyer.id), 500_000n);
  log("a retried deposit with the same key moves money once");

  await assert.rejects(transfer({ ...deposit, amount: 1n }), IdempotencyConflict);
  log("reusing a key for a different transfer is refused");

  await transfer({ key: key("fund"), kind: "FUND", fromId: buyer.id, toId: RESERVE_ID, amount: 500_000n });
  assert.equal(await balanceOf(buyer.id), 0n);
  assert.equal(await balanceOf(RESERVE_ID), reserveBefore + 500_000n);
  await assert.rejects(transfer({ key: key("overdraw"), kind: "FUND", fromId: buyer.id, toId: RESERVE_ID, amount: 1n }), InsufficientFunds);
  assert.equal(await db.bankTransfer.count({ where: { idempotencyKey: key("overdraw") } }), 0);
  log("funding moves money into the reserve; an overdraft is refused and leaves no record");

  const racer = await openAccount(`${run}-racer`, "check racer");
  await transfer({ key: key("racer-deposit"), kind: "DEPOSIT", fromId: null, toId: racer.id, amount: 100n });
  const race = await Promise.allSettled([
    transfer({ key: key("race-a"), kind: "FUND", fromId: racer.id, toId: RESERVE_ID, amount: 80n }),
    transfer({ key: key("race-b"), kind: "FUND", fromId: racer.id, toId: RESERVE_ID, amount: 80n }),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await balanceOf(racer.id), 20n);
  log("two simultaneous withdrawals of 80 from 100: exactly one succeeds");

  const sandbox = await seedSandbox(`${run}-sandbox`, 1_000_000n);
  assert.equal((await seedSandbox(`${run}-sandbox`, 1_000_000n)).balance, 1_000_000n);
  assert.equal(sandbox.balance, 1_000_000n);
  log("a sandbox is seeded with 10,000 baht exactly once");

  const totals = await ledgerTotals();
  assert.equal(totals.balances, totals.deposits);
  log(`invariant holds: all balances (${totals.balances}) = all deposits (${totals.deposits})`);

  // Put the reserve back where it was before cleaning up.
  await transfer({ key: key("refund"), kind: "REFUND", fromId: RESERVE_ID, toId: buyer.id, amount: 500_000n });
  await transfer({ key: key("refund-racer"), kind: "REFUND", fromId: RESERVE_ID, toId: racer.id, amount: 80n });
  assert.equal(await balanceOf(RESERVE_ID), reserveBefore);
  log("refunds return money from the reserve");
} finally {
  await db.bankTransfer.deleteMany({ where: { idempotencyKey: { startsWith: run } } });
  await db.bankTransfer.deleteMany({ where: { to: { ownerAddress: { startsWith: run } } } });
  await db.bankAccount.deleteMany({ where: { ownerAddress: { startsWith: run } } });
  const totals = await ledgerTotals();
  assert.equal(totals.balances, totals.deposits);
  console.log("✔ cleaned up; the ledger still balances");
  await db.$disconnect();
}
