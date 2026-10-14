import { parseUnits } from "viem";
import { z } from "zod";

import { agentWalletAbi } from "@/lib/abis";
import { account, publicClient, send } from "@/lib/chain";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";
import { walletUnits } from "@/lib/state";

export const maxDuration = 120;

/** Highest caps a user can set: the Mock Bank's own per-mint cap bounds a single deal anyway. */
const MAX = { THB: { perTx: 10_000, perDay: 100_000 }, CNY: { perTx: 2_000, perDay: 20_000 } } as const;

const Input = z.object({ maxPerTx: z.number().positive(), dailyLimit: z.number().positive() });

/** Owner action: changes the agent's Tier 2 caps (keeps the session's expiry). */
export async function PUT(req: Request) {
  try {
    rateLimit(req, "limits", 20, 60 * 60 * 1000);
    const { wallet } = await requireBankWallet();
    const body = Input.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { maxPerTx, dailyLimit } in your currency");
    const units = await walletUnits(wallet);
    const max = MAX[units.currency ?? "THB"];
    const { maxPerTx, dailyLimit } = body.data;
    if (maxPerTx > dailyLimit) throw new HttpError(400, "The per-transaction cap cannot exceed the daily cap");
    if (maxPerTx > max.perTx || dailyLimit > max.perDay) {
      throw new HttpError(400, `Caps are limited to ${max.perTx} per transaction and ${max.perDay} per day`);
    }
    const agent = account("agent").address;
    const [expiresAt] = await publicClient().readContract({ address: wallet, abi: agentWalletAbi, functionName: "sessions", args: [agent] });
    const outcome = await send("owner", {
      address: wallet,
      abi: agentWalletAbi,
      functionName: "setSession",
      args: [agent, expiresAt, parseUnits(String(maxPerTx), units.decimals), parseUnits(String(dailyLimit), units.decimals)],
    });
    return Response.json({ outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
