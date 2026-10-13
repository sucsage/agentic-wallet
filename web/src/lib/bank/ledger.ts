import "server-only";

import { type BankAccount, type BankTransfer, type BankTransferKind, Prisma } from "@prisma/client";

import { db } from "../db";

/**
 * Mock Bank ledger (demo only: simulated baht, not real money). Amounts are satang.
 *
 * Money enters only through DEPOSIT and then only moves between accounts, so at every moment
 * the sum of all balances equals the sum of all deposits. Every mTHB on-chain is backed by the
 * single RESERVE account.
 */

export const RESERVE_ID = "reserve";

export class InsufficientFunds extends Error {
  constructor(accountId: string, amount: bigint) {
    super(`Account ${accountId} cannot cover ${amount} satang`);
    this.name = "InsufficientFunds";
  }
}

/** The key was already used for a different transfer: a bug in the caller, never retried. */
export class IdempotencyConflict extends Error {
  constructor(key: string) {
    super(`Idempotency key ${key} was already used for a different transfer`);
    this.name = "IdempotencyConflict";
  }
}

export function reserveAccount(): Promise<BankAccount> {
  return db.bankAccount.upsert({
    where: { id: RESERVE_ID },
    update: {},
    create: { id: RESERVE_ID, kind: "RESERVE", label: "mTHB reserve" },
  });
}

/** One account per on-chain address; opening it again returns the same account. */
export function openAccount(ownerAddress: string, label: string): Promise<BankAccount> {
  const address = ownerAddress.toLowerCase();
  return db.bankAccount.upsert({ where: { ownerAddress: address }, update: {}, create: { ownerAddress: address, label } });
}

export function accountOf(ownerAddress: string): Promise<BankAccount | null> {
  return db.bankAccount.findUnique({ where: { ownerAddress: ownerAddress.toLowerCase() } });
}

/**
 * Moves money exactly once per `key`. Calling it again with the same key and the same transfer
 * returns the original row without moving money twice, so a caller that timed out can just retry.
 * The debit and its balance check are one statement, so concurrent transfers can never overdraw.
 */
export async function transfer(input: {
  key: string;
  kind: BankTransferKind;
  fromId: string | null;
  toId: string;
  amount: bigint;
}): Promise<BankTransfer> {
  const { key, kind, fromId, toId, amount } = input;
  if (amount <= 0n) throw new Error("Amount must be positive");
  if ((fromId === null) !== (kind === "DEPOSIT")) throw new Error("Only a deposit has no source account");

  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.bankTransfer.create({ data: { idempotencyKey: key, kind, fromId, toId, amount } });
      if (fromId) {
        const debited = await tx.bankAccount.updateMany({
          where: { id: fromId, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });
        if (debited.count !== 1) throw new InsufficientFunds(fromId, amount);
      }
      await tx.bankAccount.update({ where: { id: toId }, data: { balance: { increment: amount } } });
      return row;
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const existing = await db.bankTransfer.findUniqueOrThrow({ where: { idempotencyKey: key } });
    const same = existing.kind === kind && existing.fromId === fromId && existing.toId === toId && existing.amount === amount;
    if (!same) throw new IdempotencyConflict(key);
    return existing;
  }
}

/** Opens the sandbox's bank account and puts the demo's starting money in it, once. */
export async function seedSandbox(walletAddress: string, amount: bigint): Promise<BankAccount> {
  const account = await openAccount(walletAddress, "Sandbox buyer");
  await transfer({ key: `sandbox:${account.ownerAddress}:deposit`, kind: "DEPOSIT", fromId: null, toId: account.id, amount });
  return db.bankAccount.findUniqueOrThrow({ where: { id: account.id } });
}

/** Sum of all balances vs. sum of all deposits: equal unless money was created or lost. */
export async function ledgerTotals(): Promise<{ balances: bigint; deposits: bigint }> {
  const [balances, deposits] = await Promise.all([
    db.bankAccount.aggregate({ _sum: { balance: true } }),
    db.bankTransfer.aggregate({ _sum: { amount: true }, where: { kind: "DEPOSIT" } }),
  ]);
  return { balances: balances._sum.balance ?? 0n, deposits: deposits._sum.amount ?? 0n };
}
