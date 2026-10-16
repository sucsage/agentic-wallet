import { getAddress } from "viem";
import { z } from "zod";

import { agentWalletAbi } from "@/lib/abis";
import { send } from "@/lib/chain";
import { HttpError, errorResponse, rateLimit, requireBankSigner } from "@/lib/guard";

export const maxDuration = 120;

/**
 * Owner action: removes a payee from the allowlist. Adding goes through a friend
 * (PUT /api/friends/:id/payee), so nobody is allowlisted by a pasted address.
 */
export async function DELETE(req: Request) {
  try {
    rateLimit(req, "payee", 20, 60 * 60 * 1000);
    const { wallet } = await requireBankSigner();
    const body = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { address }");
    const outcome = await send("owner", {
      address: wallet,
      abi: agentWalletAbi,
      functionName: "setRecipient",
      args: [getAddress(body.data.address), false],
    });
    return Response.json({ outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
