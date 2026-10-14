import { z } from "zod";

import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, listFriends, requestFriend } from "@/lib/social";

/** Friends and pending requests, with each friend's wallet and whether they are an allowed payee. */
export async function GET() {
  try {
    const { user } = await requireCustomer();
    return Response.json({ friends: await listFriends(user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Sends a friend request by bank username (same bank only). Asking someone who asked you accepts. */
export async function POST(req: Request) {
  try {
    const { user, customer } = await requireCustomer();
    const body = z.object({ username: z.string().trim().min(3).max(32) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Give the friend's bank username");
    const f = await requestFriend(user.id, customer.currency, body.data.username).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ friendshipId: f.id, status: f.status });
  } catch (err) {
    return errorResponse(err);
  }
}
