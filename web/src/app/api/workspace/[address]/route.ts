import { llmLabel } from "@/lib/agent";
import { errorResponse, demoWallet } from "@/lib/guard";
import { readAudit, readWallet } from "@/lib/state";

export async function GET(_req: Request, ctx: RouteContext<"/api/workspace/[address]">) {
  try {
    const wallet = await demoWallet((await ctx.params).address);
    const state = await readWallet(wallet);
    const audit = await readAudit(
      wallet,
      BigInt(state.createdAtBlock),
      state.deals.map((d) => d.id),
    );
    return Response.json({ ...state, audit, model: llmLabel() });
  } catch (err) {
    return errorResponse(err);
  }
}
