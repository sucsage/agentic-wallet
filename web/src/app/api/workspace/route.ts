import { createWorkspace } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import { errorResponse, rateLimit } from "@/lib/guard";
import { linkNewWallet } from "@/lib/user-wallets";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    rateLimit(req, "create", 5, 60 * 60 * 1000);
    const { address, outcome } = await createWorkspace();
    // Signing in is optional (judges click through without an account). When signed in, remember
    // the wallet on the user's profile; a DB hiccup must not fail an on-chain deploy that succeeded.
    const session = await getSession();
    if (session && "hash" in outcome) {
      await linkNewWallet(session.user.id, address, outcome.hash).catch((err) =>
        console.error("linkNewWallet failed", err),
      );
    }
    return Response.json({ address, outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
