import { createWorkspace } from "@/lib/actions";
import { errorResponse, rateLimit, requireUser } from "@/lib/guard";
import { linkNewWallet } from "@/lib/user-wallets";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    rateLimit(req, "create", 5, 60 * 60 * 1000);
    const { address, outcome } = await createWorkspace();
    // Access to a wallet is granted only through this link, so it has to succeed.
    if ("hash" in outcome) await linkNewWallet(user.id, address, outcome.hash);
    return Response.json({ address, outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
