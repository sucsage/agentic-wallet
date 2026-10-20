import { parseUnits } from "viem";
import { z } from "zod";

import { agentWalletAbi } from "@/lib/abis";
import { account, publicClient, send } from "@/lib/chain";
import { HttpError, errorResponse, rateLimit, requireBankSigner } from "@/lib/guard";
import { AGENT_LIMIT_RANGE } from "@/lib/send-limits";
import { walletUnits } from "@/lib/state";

export const maxDuration = 120;


const Input = z.object({ maxPerTx: z.number().positive(), dailyLimit: z.number().positive() });

/** Owner action: changes the agent's Tier 2 caps (keeps the session's expiry). */
export async function PUT(req: Request) {
  try {
    rateLimit(req, "limits", 20, 60 * 60 * 1000);
    const { wallet } = await requireBankSigner();
    const body = Input.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { maxPerTx, dailyLimit } in your currency");
    const units = await walletUnits(wallet);
    const max = AGENT_LIMIT_RANGE[units.currency ?? "THB"];
    const { maxPerTx, dailyLimit } = body.data;
    if (maxPerTx > dailyLimit) throw new HttpError(400, "The per-transaction cap cannot exceed the daily cap");
    if (maxPerTx < max.perTxMin || maxPerTx > max.perTx) {
      throw new HttpError(400, `Per transaction: between ${max.perTxMin.toLocaleString("en-US")} and ${max.perTx.toLocaleString("en-US")}`);
    }
    if (dailyLimit > max.perDay) throw new HttpError(400, `Per day: at most ${max.perDay.toLocaleString("en-US")}`);
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
