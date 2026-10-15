import { z } from "zod";

import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";
import { SocialError, setFriendPayee } from "@/lib/social";

export const maxDuration = 120;

/**
 * Owner action (Tier 1, the user's click): lets the agent pay this friend's wallet, or stops it.
 * Being friends alone never does this.
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/friends/[id]/payee">) {
  try {
    rateLimit(req, "payee", 20, 60 * 60 * 1000);
    // Acting as a company: the payee is added to the company wallet.
    const { user, wallet } = await requireBankWallet();
    const body = z.object({ allowed: z.boolean() }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { allowed: true | false }");
    const outcome = await setFriendPayee(user.id, (await ctx.params).id, body.data.allowed, wallet).catch((e) => {
      throw e instanceof SocialError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
