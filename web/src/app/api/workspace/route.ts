import { createWorkspace } from "@/lib/actions";
import { backWallet, freeLinkedAccount } from "@/lib/bank/customers";
import { config } from "@/lib/config";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { linkNewWallet } from "@/lib/user-wallets";

export const maxDuration = 60;

/**
 * Creates the signed-in customer's agent wallet. It settles in their bank's currency (mTHB or
 * mCNY) and is paid from one of their linked accounts, debited only when a deal locks.
 */
export async function POST(req: Request) {
  try {
    const { user, customer } = await requireCustomer();
    rateLimit(req, "create", 5, 60 * 60 * 1000);
    const bankToken = config.bankToken(customer.currency);
    // Check before deploying, so a wallet is never created that no bank account can pay for.
    const account = bankToken ? await freeLinkedAccount(customer.id) : null;
    if (bankToken && !account) {
      throw new HttpError(409, "Every linked bank account already pays for a wallet. Link another account first.");
    }
    const { address, outcome, units } = await createWorkspace({ currency: customer.currency });
    // Access to a wallet is granted only through this link, so it has to succeed.
    if ("hash" in outcome) await linkNewWallet(user.id, address, outcome.hash, bankToken ?? config.contracts.usdc);
    if (account) await backWallet(account.id, address);
    return Response.json({ address, outcome, units, bankAccountId: account?.id ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
