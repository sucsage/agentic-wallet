import { maskAccountNo } from "@/lib/bank/customers";
import { explorerTx } from "@/lib/config";
import { db } from "@/lib/db";
import { HttpError, errorResponse, requireActingCustomer } from "@/lib/guard";

const KIND_LABEL = {
  DEPOSIT: "Opening deposit",
  FUND: "Locked for a deal",
  REFUND: "Refund from a deal",
  PAYOUT: "Payment received",
  WITHDRAW: "Payment from a deal (invited seller)",
  TOPUP: "Card top-up (Stripe test)",
  TRANSFER: "Moved between your accounts",
} as const;

/**
 * Statement of one linked account, newest first. Pages with ?cursor=<last id>&limit=<1-100>.
 * Each row that mirrors an on-chain mint or redeem links to it.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/bank/accounts/[id]/transactions">) {
  try {
    const { customer } = await requireActingCustomer();
    const { id } = await ctx.params;
    const account = await db.bankAccount.findFirst({ where: { id, customerId: customer.id, linkedAt: { not: null } } });
    // 404 for someone else's account too: don't confirm it exists.
    if (!account) throw new HttpError(404, "Account not found among your linked accounts");

    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100);
    const cursor = url.searchParams.get("cursor");
    const rows = await db.bankTransfer.findMany({
      where: { OR: [{ fromId: id }, { toId: id }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: { from: { select: { accountNo: true, kind: true } }, to: { select: { accountNo: true, kind: true } } },
    });
    const page = rows.slice(0, limit);
    return Response.json({
      account: { id: account.id, accountNo: maskAccountNo(account.accountNo), currency: account.currency, balance: account.balance.toString() },
      transactions: page.map((t) => {
        const incoming = t.toId === id;
        const other = incoming ? t.from : t.to;
        return {
          id: t.id,
          kind: t.kind,
          label: KIND_LABEL[t.kind],
          direction: incoming ? "in" : "out",
          amount: t.amount.toString(),
          counterparty: !other ? "Mock Bank" : other.kind === "RESERVE" ? "Agentic Wallet escrow" : maskAccountNo(other.accountNo),
          txHash: t.txHash,
          explorer: t.txHash ? explorerTx(t.txHash) : null,
          createdAt: t.createdAt,
        };
      }),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
