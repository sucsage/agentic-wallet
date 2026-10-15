import { accountView, customerAccounts, customerOfUser } from "@/lib/bank/customers";
import { db } from "@/lib/db";
import { errorResponse, requireCustomer, requireUser } from "@/lib/guard";
import { listUserWallets } from "@/lib/user-wallets";

/** Who is signed in: their bank, linked accounts and wallets. The app's first call after sign-in. */
export async function GET() {
  try {
    const user = await requireUser();
    const customer = await customerOfUser(user.id);
    // Signed up but no wallet account yet: identity verification comes first.
    if (!customer) {
      const application = await db.kycApplication.findUnique({ where: { userId: user.id } });
      return Response.json({
        user: { id: user.id, name: user.name },
        onboarding: { status: application?.status ?? "NOT_STARTED", note: application?.reviewNote ?? null },
        accounts: [],
        wallets: [],
      });
    }
    const [accounts, wallets] = await Promise.all([customerAccounts(customer.id), listUserWallets(user.id)]);
    return Response.json({
      user: { id: user.id, name: user.name },
      bank: {
        name: customer.currency === "THB" ? "Agentic Wallet · THB e-money" : "Agentic Wallet · CNY e-money",
        currency: customer.currency,
        token: customer.currency === "THB" ? "mTHB" : "mCNY",
        customerType: customer.type,
        consentedAt: customer.consentedAt,
      },
      accounts: accounts.filter((a) => a.linkedAt).map(accountView),
      wallets: wallets.map((w) => ({
        address: w.walletAddress,
        role: w.role,
        label: w.label,
        openProposals: w.wallet._count.proposals,
        createdAt: w.wallet.createdAt,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PDPA right to erasure: deletes the app user, their profile, sessions and wallet links, and
 * withdraws the bank consent (accounts are unlinked). What stays: the demo bank's own customer
 * record (the bank is a separate party) and on-chain transactions, which hold only addresses,
 * amounts and hashes, never names.
 */
export async function DELETE() {
  try {
    const { user, customer } = await requireCustomer();
    await db.$transaction([
      db.bankAccount.updateMany({ where: { customerId: customer.id }, data: { linkedAt: null } }),
      db.bankCustomer.update({ where: { id: customer.id }, data: { consentedAt: null } }),
      // Cascades to sessions, sign-in accounts, profile and wallet links; customer.userId -> null.
      db.user.delete({ where: { id: user.id } }),
    ]);
    return Response.json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
