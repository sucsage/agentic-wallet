import "server-only";

import type { Address } from "viem";

import { createWorkspace } from "../actions";
import { config } from "../config";
import { db } from "../db";
import { HttpError } from "../guard";
import { linkNewWallet, primaryWalletAddress } from "../user-wallets";
import { backWallet, freeLinkedAccount } from "./customers";

/** One creation at a time per user on this instance (double clicks, two tabs, the app and the website). */
const creating = new Map<string, Promise<{ address: Address; existing: boolean; outcome?: unknown; units?: unknown; bankAccountId?: string | null }>>();

/**
 * Creates the customer's agent wallet (website onboarding and the desktop app). It settles in
 * their currency (mTHB or mCNY) and is paid from their wallet account, debited only when a deal
 * locks. Idempotent: a user has one agent wallet; asking again returns it.
 */
export async function createUserWallet(userId: string) {
  const existing = await primaryWalletAddress(userId);
  if (existing) return { address: existing, existing: true };
  const running = creating.get(userId);
  if (running) return running;
  const run = (async () => {
    const customer = await db.bankCustomer.findUnique({ where: { userId } });
    if (!customer) throw new HttpError(403, "Verify your identity first: it opens your wallet account");
    const bankToken = config.bankToken(customer.currency);
    // Check before deploying, so a wallet is never created that no account can pay for.
    const account = bankToken ? await freeLinkedAccount(customer.id) : null;
    if (bankToken && !account) throw new HttpError(409, "Every linked bank account already pays for a wallet. Link another account first.");
    const { address, outcome, units } = await createWorkspace({ currency: customer.currency });
    // Access to a wallet is granted only through this link, so it has to succeed.
    if ("hash" in outcome) await linkNewWallet(userId, address, outcome.hash, bankToken ?? config.contracts.usdc);
    if (account) await backWallet(account.id, address);
    return { address, existing: false, outcome, units, bankAccountId: account?.id ?? null };
  })().finally(() => creating.delete(userId));
  creating.set(userId, run);
  return run;
}
