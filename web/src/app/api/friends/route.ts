import { getAddress } from "viem";
import { z } from "zod";

import { HttpError, actingAs, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, listFriends, requestFriend } from "@/lib/social";

/** Friends and pending requests, with each friend's wallet and whether they are an allowed payee. */
export async function GET() {
  try {
    const { user } = await requireCustomer();
    // "Allowlisted" refers to the wallet the user acts as (a company's, or their own).
    const company = await actingAs(user.id);
    return Response.json({ friends: await listFriends(user.id, company ? getAddress(company.walletAddress) : undefined) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Sends a friend request by username, exact name or email (same bank only). Asking someone who asked you accepts. */
export async function POST(req: Request) {
  try {
    const { user, customer } = await requireCustomer();
    const body = z.object({ username: z.string().trim().min(2).max(80) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Give their username, name or email");
    const f = await requestFriend(user.id, customer.currency, body.data.username).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ friendshipId: f.id, status: f.status });
  } catch (err) {
    return errorResponse(err);
  }
}
