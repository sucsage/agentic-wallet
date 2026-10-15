import { z } from "zod";

import { accountView, customerAccounts, linkAccounts } from "@/lib/bank/customers";
import { HttpError, errorResponse, requireActingCustomer } from "@/lib/guard";

/** The customer's passbooks. Linked ones carry balances; unlinked ones can be linked with PUT. */
export async function GET() {
  try {
    const { customer } = await requireActingCustomer();
    const accounts = await customerAccounts(customer.id);
    return Response.json({ currency: customer.currency, accounts: accounts.map(accountView) });
  } catch (err) {
    return errorResponse(err);
  }
}

const LinkInput = z.object({
  accountIds: z.array(z.string()).min(1).max(10),
  defaultAccountId: z.string().optional(),
  consent: z.literal(true),
});

/**
 * Changes which accounts the app may use, and the default one (consent again). An account that
 * already pays for a wallet cannot be unlinked here while the wallet exists.
 */
export async function PUT(req: Request) {
  try {
    const { customer } = await requireActingCustomer();
    const parsed = LinkInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    const own = await customerAccounts(customer.id);
    const backing = own.filter((a) => a.ownerAddress && a.linkedAt && !parsed.data.accountIds.includes(a.id));
    if (backing.length) throw new HttpError(409, "An account that pays for a wallet must stay linked");
    const accounts = await linkAccounts(customer.id, parsed.data.accountIds, parsed.data.defaultAccountId).catch((e) => {
      throw new HttpError(400, e instanceof Error ? e.message : "Invalid accounts");
    });
    return Response.json({ accounts: accounts.map(accountView) });
  } catch (err) {
    return errorResponse(err);
  }
}
