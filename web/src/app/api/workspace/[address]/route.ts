import { llmLabel } from "@/lib/agent";
import { errorResponse, requireUser, userWallet } from "@/lib/guard";
import { friendLabels } from "@/lib/social";
import { readAudit, readWallet } from "@/lib/state";

export async function GET(_req: Request, ctx: RouteContext<"/api/workspace/[address]">) {
  try {
    const wallet = await userWallet((await ctx.params).address);
    const state = await readWallet(wallet);
    const audit = await readAudit(
      wallet,
      BigInt(state.createdAtBlock),
      state.deals.map((d) => d.id),
    );
    // The other side by the name the user knows: a contact, or someone invited by link.
    const names = await friendLabels((await requireUser()).id);
    const fileDeals = state.fileDeals.map((d) => ({ ...d, counterpartyLabel: names.get(d.counterparty.toLowerCase()) ?? d.counterpartyLabel }));
    return Response.json({ ...state, fileDeals, audit, model: llmLabel() });
  } catch (err) {
    return errorResponse(err);
  }
}
