import { after } from "next/server";

import { DealError, dealForWallet, dealTerms, demoDeliverable, syncDeal } from "@/lib/bank/deals";
import { draftView } from "@/lib/bank/drafts";
import { roleAddresses } from "@/lib/chain";
import { config, explorerAddress } from "@/lib/config";
import { HttpError, errorResponse, requireBankWallet } from "@/lib/guard";

/** What the buyer can do with a milestone in its current state (the contract has the last word). */
function buyerMoves(status: string, deadline: number): string[] {
  const open = Date.now() / 1000 <= deadline;
  if (status === "Delivered") return open ? ["approve", "dispute"] : ["approve"];
  if (status === "KeyReleased") return open ? ["dispute"] : [];
  if (status === "Approved") return open ? [] : ["reclaim"];
  return [];
}

/** One deal: milestones with deadlines and the moves available now, plus its off-chain terms. */
export async function GET(_req: Request, ctx: RouteContext<"/api/deals/[id]">) {
  try {
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 0) throw new HttpError(400, "Invalid deal id");
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    after(() => syncDeal(wallet, id).catch((e) => console.error("syncDeal", id, e)));
    const draft = await dealTerms(user.id, id);
    const terms = draft ? await draftView(draft) : null;
    const demoSeller = deal.counterparty === roleAddresses().contractor;
    return Response.json({
      ...deal,
      title: terms?.title ?? `File deal #${id}`,
      summary: terms?.summary ?? null,
      escrow: explorerAddress(config.bankContracts.fileEscrow),
      demoSeller,
      canCancel: deal.role === "buyer" && deal.status === "Proposed",
      milestones: deal.milestones.map((m, i) => ({
        ...m,
        name: terms?.milestones[i]?.name ?? `Milestone ${i + 1}`,
        acceptance: terms?.milestones[i]?.acceptance ?? null,
        moves: deal.role === "buyer" && deal.status === "Active" ? buyerMoves(m.status, m.deadline) : [],
        // The demo file stands in for decrypting the real one once the key is out.
        deliverable: ["KeyReleased", "Released"].includes(m.status) && demoSeller ? demoDeliverable(id, i) : null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
