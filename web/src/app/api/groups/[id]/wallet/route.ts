import { CompanyError, createGroupWallet } from "@/lib/company";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

export const maxDuration = 60;

/** The group's owner opens its shared wallet: the group can then hire and sell in its own name. */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/[id]/wallet">) {
  try {
    rateLimit(req, "group-wallet", 5, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const c = await createGroupWallet(user.id, (await ctx.params).id).catch((e) => {
      throw e instanceof CompanyError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ id: c.id, wallet: c.walletAddress });
  } catch (err) {
    return errorResponse(err);
  }
}
