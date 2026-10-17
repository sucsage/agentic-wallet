import { getAddress } from "viem";

import { DealError, dealForWallet, dealTerms, deliveryInfo } from "@/lib/bank/deals";
import { draftView } from "@/lib/bank/drafts";
import { companyOfWallet } from "@/lib/company";
import { config } from "@/lib/config";
import { revisionsAllowed } from "@/lib/file-types";
import { DOC_TYPES, type DocType, renderDealDocument } from "@/lib/deal-documents";
import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";
import { friendLabels } from "@/lib/social";
import { walletUnits } from "@/lib/state";

/**
 * GET /api/deals/D/document?type=contract|receipt|request|tax|claim[&download=1]: a printable page for
 * either party of the deal (Print / Save as PDF in the browser).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/deals/[id]/document">) {
  try {
    rateLimit(req, "deal-document", 120, 60 * 60 * 1000);
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const url = new URL(req.url);
    const type = url.searchParams.get("type") as DocType;
    if (!Number.isInteger(id) || !DOC_TYPES.includes(type)) throw new HttpError(400, "Choose a document: contract, receipt, request, tax or claim");
    const deal = await dealForWallet(wallet, id).catch((e) => {
      throw e instanceof DealError ? new HttpError(404, e.message) : e;
    });
    const buyerAddr = deal.role === "buyer" ? wallet : deal.counterparty;
    const sellerAddr = deal.role === "seller" ? wallet : deal.counterparty;
    const draft = await dealTerms(id, buyerAddr, sellerAddr);
    const terms = draft ? await draftView(draft) : null;
    const [labels, company, other, units, witnesses, deliveries, disputes, guarantors] = await Promise.all([
      friendLabels(user.id),
      companyOfWallet(wallet),
      companyOfWallet(getAddress(deal.counterparty)),
      walletUnits(wallet),
      db.dealWitness.findMany({ where: { escrow: config.fileEscrowOf(id), dealId: id } }),
      Promise.all(deal.milestones.map((m) => deliveryInfo(id, m.index))),
      db.dealDispute.findMany({ where: { escrow: config.fileEscrowOf(id), dealId: id }, orderBy: { createdAt: "asc" } }),
      db.dealGuarantor.findMany({ where: { escrow: config.fileEscrowOf(id), dealId: id } }),
    ]);
    const me = { name: company?.name ?? user.name, taxId: company?.maskedTaxId ?? null };
    const them = { name: other?.name ?? labels.get(deal.counterparty.toLowerCase()) ?? deal.counterpartyLabel ?? "Other party", taxId: other?.maskedTaxId ?? null };
    const html = renderDealDocument(type, {
      dealId: id,
      currency: units.currency ?? "THB",
      status: deal.status,
      kind: terms?.kind ?? "HIRE",
      title: terms?.title ?? `Deal D-${id}`,
      summary: terms?.summary ?? null,
      shipTo: terms?.shipTo ?? null,
      reviewHours: deal.reviewHours,
      termsHash: draft?.termsHash ?? null,
      escrow: config.fileEscrowOf(id),
      createdAt: draft?.createdAt.toISOString() ?? null,
      buyer: deal.role === "buyer" ? me : them,
      seller: deal.role === "seller" ? me : them,
      witnesses: witnesses.map((w) => ({ side: w.side, name: w.name, contact: w.contact })),
      viewer: deal.role,
      rules: draft?.rules ?? null,
      guarantors: guarantors.map((g) => ({ side: g.side, name: g.name, contact: g.contact, relation: g.relation, amount: g.amount === null ? null : Number(g.amount) })),
      disputes: disputes.map((x) => ({
        index: x.index,
        phase: x.phase,
        reason: x.reason,
        status: x.status,
        stage: x.stage,
        decision: x.decision,
        rationale: x.rationale,
        sellerStatement: x.sellerStatement,
        at: x.createdAt.toISOString(),
        txHash: x.txHash,
      })),
      milestones: deal.milestones.map((m, i) => ({
        index: m.index,
        name: terms?.milestones[i]?.name ?? `Milestone ${i + 1}`,
        acceptance: terms?.milestones[i]?.acceptance ?? null,
        amount: Number(m.amount),
        status: m.status,
        deadline: m.deadline,
        deposit: terms?.milestones[i]?.deposit === true,
        revisions: revisionsAllowed(terms?.milestones[i]?.revisions),
        paidToSeller: m.status === "Released" ? Number(m.amount) : m.status === "Split" ? Number(m.split?.toSeller ?? 0) : 0,
        deliveredAt: deliveries[i]?.deliveredAt ? new Date(deliveries[i]!.deliveredAt).toISOString() : null,
        delivery: deliveries[i] ? { note: deliveries[i]!.note, fileName: deliveries[i]!.fileName, sha256: deliveries[i]!.sha256 } : null,
      })),
    });
    const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" };
    if (url.searchParams.get("download")) headers["content-disposition"] = `attachment; filename="D-${id}-${type}.html"`;
    return new Response(html, { headers });
  } catch (err) {
    return errorResponse(err);
  }
}
