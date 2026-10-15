import { errorResponse, requireCustomer } from "@/lib/guard";
import { myGroupInvites } from "@/lib/social";

/** Group (and company) invitations waiting for this user. */
export async function GET() {
  try {
    const { user } = await requireCustomer();
    return Response.json({ invites: await myGroupInvites(user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}
