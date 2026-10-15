import { z } from "zod";

import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";
import { SocialError, proposeRule } from "@/lib/social";

const Input = z.object({
  kind: z.enum(["ADD_SIGNER", "REMOVE_SIGNER", "REMOVE_MEMBER", "SET_THRESHOLD"]),
  targetUserId: z.string().optional(),
  threshold: z.number().int().min(2).max(50).optional(),
});

/** Proposes a change to the group's rules; the signers vote on it like on a payment. */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/[id]/rules">) {
  try {
    const { user } = await requireCustomer();
    const body = Input.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Invalid rule change");
    const r = await proposeRule(user.id, (await ctx.params).id, body.data).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
