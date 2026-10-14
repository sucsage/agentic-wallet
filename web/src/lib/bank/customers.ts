import "server-only";

import { hashPassword, verifyPassword } from "better-auth/crypto";

import type { BankAccount, BankCustomer, BankCustomerType, Currency } from "@/generated/prisma/client";

import { db } from "../db";
import { transfer } from "./ledger";

/**
 * The Mock Bank's own side: its customers, their passbooks and the PIN check.
 * Demo only. It stands in for a real bank's login and open-banking consent, so it must never ask
 * for, or look like it accepts, real bank credentials.
 */

export type BankChoice = "thai" | "chinese";

export const BANK_CURRENCY: Record<BankChoice, Currency> = { thai: "THB", chinese: "CNY" };
export const BANK_NAME: Record<Currency, string> = { THB: "Mock Bank Thailand", CNY: "Mock Bank China" };

/** Wrong PINs in a row before the customer is locked out, and for how long. */
const MAX_FAILED_PINS = 5;
const LOCK_MS = 15 * 60 * 1000;
const DUMMY_HASH = await hashPassword("dummy-pin-for-timing");

/** Opening balances in minor units, so a new tester can make deals right away. */
const OPENING_ACCOUNTS: Record<Currency, Record<BankCustomerType, { label: string; balance: bigint }[]>> = {
  THB: {
    PERSONAL: [
      { label: "Savings · main", balance: 5_000_000n }, // 50,000 baht
      { label: "Savings · freelance income", balance: 1_000_000n }, // 10,000 baht
    ],
    COMPANY: [
      { label: "Current · operating", balance: 20_000_000n }, // 200,000 baht
      { label: "Savings · tax reserve", balance: 2_000_000n }, // 20,000 baht
    ],
  },
  CNY: {
    PERSONAL: [
      { label: "Savings · main", balance: 1_000_000n }, // 10,000 yuan
      { label: "Savings · studio", balance: 300_000n }, // 3,000 yuan
    ],
    COMPANY: [
      { label: "Current · operating", balance: 4_000_000n }, // 40,000 yuan
      { label: "Savings · tax reserve", balance: 500_000n }, // 5,000 yuan
    ],
  },
};

export class BankError extends Error {
  constructor(
    public code: "USERNAME_TAKEN" | "INVALID_LOGIN" | "LOCKED" | "UNKNOWN_ACCOUNT",
    message: string,
  ) {
    super(message);
    this.name = "BankError";
  }
}

/** What the app may show about an account: never the full number, since screens get shared. */
export type AccountView = {
  id: string;
  accountNo: string;
  label: string;
  currency: Currency;
  balance: string;
  linked: boolean;
  isDefault: boolean;
};

export function maskAccountNo(accountNo: string | null): string {
  if (!accountNo) return "";
  return `··${accountNo.replace(/\D/g, "").slice(-4)}`;
}

export function accountView(a: BankAccount): AccountView {
  return {
    id: a.id,
    accountNo: maskAccountNo(a.accountNo),
    label: a.label,
    currency: a.currency,
    // Minor units as a string: BigInt does not survive JSON.
    balance: a.balance.toString(),
    linked: a.linkedAt !== null,
    isDefault: a.isDefault,
  };
}

function randomDigits(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => String(b % 10)).join("");
}

/** Thai style 123-4-56789-0, Chinese style 6222 0000 0000 0000 (both fake: the prefix is "999"). */
function newAccountNo(currency: Currency): string {
  if (currency === "THB") {
    const d = `999${randomDigits(7)}`;
    return `${d.slice(0, 3)}-${d[3]}-${d.slice(4, 9)}-${d[9]}`;
  }
  const d = `9990${randomDigits(12)}`;
  return d.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Opens a demo customer with two passbooks and their opening money. */
export async function registerCustomer(input: {
  currency: Currency;
  username: string;
  displayName: string;
  pin: string;
  type: BankCustomerType;
}): Promise<{ customer: BankCustomer; accounts: BankAccount[] }> {
  const username = input.username.toLowerCase();
  if (await db.bankCustomer.findUnique({ where: { currency_username: { currency: input.currency, username } } })) {
    throw new BankError("USERNAME_TAKEN", "This username is already taken at this bank");
  }
  const customer = await db.bankCustomer.create({
    data: {
      currency: input.currency,
      username,
      displayName: input.displayName,
      type: input.type,
      pinHash: await hashPassword(input.pin),
    },
  });
  const accounts: BankAccount[] = [];
  for (const [i, opening] of OPENING_ACCOUNTS[input.currency][input.type].entries()) {
    let account: BankAccount | null = null;
    // Account numbers are random; retry the rare collision instead of failing the sign-up.
    for (let attempt = 0; !account && attempt < 5; attempt++) {
      account = await db.bankAccount
        .create({
          data: {
            label: opening.label,
            currency: input.currency,
            accountNo: newAccountNo(input.currency),
            customerId: customer.id,
            isDefault: i === 0,
          },
        })
        .catch(() => null);
    }
    if (!account) throw new Error("Could not open a bank account");
    await transfer({ key: `opening:${account.id}`, kind: "DEPOSIT", fromId: null, toId: account.id, amount: opening.balance });
    accounts.push(await db.bankAccount.findUniqueOrThrow({ where: { id: account.id } }));
  }
  return { customer, accounts };
}

/**
 * Checks a customer's PIN. Five wrong PINs lock the customer for 15 minutes; the error never says
 * whether the username exists.
 */
export async function verifyCustomer(currency: Currency, rawUsername: string, pin: string): Promise<BankCustomer> {
  const username = rawUsername.toLowerCase();
  const customer = await db.bankCustomer.findUnique({ where: { currency_username: { currency, username } } });
  if (!customer) {
    // Same work as a real check, so timing does not reveal which usernames exist.
    await verifyPassword({ hash: DUMMY_HASH, password: pin }).catch(() => false);
    throw new BankError("INVALID_LOGIN", "Wrong username or PIN");
  }
  if (customer.lockedUntil && customer.lockedUntil > new Date()) {
    throw new BankError("LOCKED", "Too many wrong PINs. Try again in 15 minutes");
  }
  if (!(await verifyPassword({ hash: customer.pinHash, password: pin }))) {
    const failed = customer.failedPins + 1;
    await db.bankCustomer.update({
      where: { id: customer.id },
      data:
        failed >= MAX_FAILED_PINS
          ? { failedPins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) }
          : { failedPins: failed },
    });
    throw new BankError("INVALID_LOGIN", "Wrong username or PIN");
  }
  if (customer.failedPins !== 0 || customer.lockedUntil) {
    await db.bankCustomer.update({ where: { id: customer.id }, data: { failedPins: 0, lockedUntil: null } });
  }
  return customer;
}


export function customerAccounts(customerId: string): Promise<BankAccount[]> {
  return db.bankAccount.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } });
}

/**
 * Records the customer's consent: exactly `accountIds` become linked to the app, the rest are
 * unlinked, and one of them is the default the app debits.
 */
export async function linkAccounts(customerId: string, accountIds: string[], defaultId?: string): Promise<BankAccount[]> {
  const own = await customerAccounts(customerId);
  const ids = new Set(accountIds);
  if (ids.size === 0 || [...ids].some((id) => !own.some((a) => a.id === id))) {
    throw new BankError("UNKNOWN_ACCOUNT", "Choose at least one of your own accounts");
  }
  const def = defaultId ?? own.find((a) => ids.has(a.id) && a.isDefault)?.id ?? [...ids][0];
  if (!ids.has(def)) throw new BankError("UNKNOWN_ACCOUNT", "The default account must be one you link");
  const now = new Date();
  await db.$transaction([
    ...own.map((a) =>
      db.bankAccount.update({
        where: { id: a.id },
        data: { linkedAt: ids.has(a.id) ? (a.linkedAt ?? now) : null, isDefault: a.id === def },
      }),
    ),
    db.bankCustomer.update({ where: { id: customerId }, data: { consentedAt: now } }),
  ]);
  return customerAccounts(customerId);
}

/** The signed-in user's bank customer, or null (e.g. a user from before the Mock Bank login). */
export function customerOfUser(userId: string): Promise<BankCustomer | null> {
  return db.bankCustomer.findUnique({ where: { userId } });
}

/**
 * The linked account a new wallet will debit: the default one if it backs no wallet yet, else any
 * other free linked account. One account backs one wallet, because funding looks the account up by
 * the wallet's address.
 */
export async function freeLinkedAccount(customerId: string): Promise<BankAccount | null> {
  const free = await db.bankAccount.findMany({
    where: { customerId, linkedAt: { not: null }, ownerAddress: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    take: 1,
  });
  return free[0] ?? null;
}

/** Ties a bank account to the wallet it pays for, so fundJustInTime debits it. */
export async function backWallet(accountId: string, wallet: string): Promise<BankAccount> {
  // Only a free account: two wallets created at once must not both claim it.
  const { count } = await db.bankAccount.updateMany({
    where: { id: accountId, ownerAddress: null },
    data: { ownerAddress: wallet.toLowerCase() },
  });
  if (count !== 1) throw new BankError("UNKNOWN_ACCOUNT", "This bank account already pays for another wallet");
  return db.bankAccount.findUniqueOrThrow({ where: { id: accountId } });
}
