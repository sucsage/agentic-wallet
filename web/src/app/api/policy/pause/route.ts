import { z } from "zod";

import { pause, unpause } from "@/lib/actions";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

export const maxDuration = 60;

/** Emergency stop (Tier 3) or resume. Pausing blocks the agent and every proposal on-chain. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "pause", 20, 60 * 60 * 1000);
    const { wallet } = await requireBankWallet();
    const body = z.object({ paused: z.boolean(), reason: z.string().max(200).optional() }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Send { paused: true | false }");
    const result = body.data.paused ? await pause(wallet, "owner", body.data.reason) : await unpause(wallet);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
