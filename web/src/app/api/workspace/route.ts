import { createUserWallet } from "@/lib/bank/create-wallet";
import { errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { primaryWalletAddress } from "@/lib/user-wallets";

export const maxDuration = 120;

/**
 * Creates the signed-in customer's agent wallet (lib/bank/create-wallet). Idempotent: asking again
 * returns the one they have.
 */
export async function POST(req: Request) {
  try {
    const { user } = await requireCustomer();
    const existing = await primaryWalletAddress(user.id);
    if (existing) return Response.json({ address: existing, existing: true });
    rateLimit(req, "create", 5, 60 * 60 * 1000);
    return Response.json(await createUserWallet(user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
