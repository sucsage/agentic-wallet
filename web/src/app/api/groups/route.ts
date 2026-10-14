import { z } from "zod";

import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, createGroup, listGroups } from "@/lib/social";

export async function GET() {
  try {
    const { user } = await requireCustomer();
    const groups = await listGroups(user.id);
    return Response.json({
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        currency: g.currency,
        threshold: g.threshold,
        members: g.members.map((m) => ({ userId: m.user.id, name: m.user.name, role: m.role })),
        openProposals: g.proposals.length,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

const Input = z.object({
  name: z.string().trim().min(1).max(80),
  memberIds: z.array(z.string()).max(20),
  threshold: z.number().int().min(1),
});

/** Creates a group of friends; `threshold` yes votes lock a group deal (N of M, creator included). */
export async function POST(req: Request) {
  try {
    const { user, customer } = await requireCustomer();
    const body = Input.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "Invalid input");
    const g = await createGroup(user.id, customer.currency, body.data).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ id: g.id });
  } catch (err) {
    return errorResponse(err);
  }
}
