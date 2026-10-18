import { claimedInvites } from "@/lib/bank/invites";
import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/guard";

/** Seller invites linked to this account: the deals someone hired the user for through a link. */
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await claimedInvites(user.id);
    const buyers = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return Response.json({ invites: rows.map((r) => ({ id: r.id, buyer: buyers.get(r.userId) ?? "a buyer", href: `/invite/id.${r.id}`, linkedAt: r.claimedAt })) });
  } catch (err) {
    return errorResponse(err);
  }
}
