import { db } from "@/lib/db";
import { errorResponse, requireCustomer } from "@/lib/guard";

/** PDPA / PIPL data portability: everything the app holds about the signed-in user, as JSON. */
export async function GET() {
  try {
    const { user, customer } = await requireCustomer();
    const [profile, wallets, accounts] = await Promise.all([
      db.profile.findUnique({ where: { userId: user.id } }),
      db.userWallet.findMany({ where: { userId: user.id } }),
      db.bankAccount.findMany({
        where: { customerId: customer.id, linkedAt: { not: null } },
        include: { outgoing: true, incoming: true },
      }),
    ]);
    const data = {
      exportedAt: new Date().toISOString(),
      user: { id: user.id, name: user.name, createdAt: user.createdAt },
      profile,
      bankCustomer: {
        bank: customer.currency,
        username: customer.username,
        displayName: customer.displayName,
        type: customer.type,
        consentedAt: customer.consentedAt,
      },
      linkedAccounts: accounts.map((a) => ({
        accountNo: a.accountNo,
        label: a.label,
        currency: a.currency,
        balance: a.balance,
        walletAddress: a.ownerAddress,
        transfers: [...a.outgoing, ...a.incoming].sort((x, y) => +x.createdAt - +y.createdAt),
      })),
      wallets,
    };
    const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
    return new Response(body, {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="agentic-wallet-export-${user.id}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
