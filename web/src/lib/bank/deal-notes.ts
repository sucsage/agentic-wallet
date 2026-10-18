import "server-only";

import { type Address, getAddress } from "viem";

import { config } from "../config";
import { db } from "../db";
import { revisionsAllowed } from "../file-types";
import { DealError, dealForWallet, dealTerms } from "./deals";
import type { DraftMilestone } from "./drafts";

export class NoteError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * A request from the buyer to the seller (the website and the desktop app): CHANGES asks the
 * seller to fix a delivery under review, within the rounds agreed for the milestone; REVISION asks
 * for a different offer. Off-chain only: asking for changes does not stop the review window.
 */
export async function addBuyerNote(wallet: Address, id: number, input: { kind: "CHANGES" | "REVISION"; index?: number; text: string }) {
  const deal = await dealForWallet(wallet, id).catch((e) => {
    throw e instanceof DealError ? new NoteError(e.message, 404) : e;
  });
  if (deal.role !== "buyer") throw new NoteError("Only the buyer asks for changes", 403);
  const { kind, index, text } = input;
  if (kind === "CHANGES") {
    const m = deal.milestones[index ?? -1];
    if (!m || m.status !== "Delivered") throw new NoteError("Changes can be asked for while a delivery is under review");
    const terms = await dealTerms(id, wallet, getAddress(deal.counterparty));
    const allowed = revisionsAllowed((terms?.milestones as DraftMilestone[] | undefined)?.[m.index]?.revisions);
    const used = await db.dealNote.count({ where: { escrow: config.fileEscrowOf(id), dealId: id, index: m.index, kind: "CHANGES" } });
    if (used >= allowed) {
      throw new NoteError(
        config.disputesOpen
          ? `All ${allowed} rounds of changes agreed for this milestone are used. Approve the delivery, or open a dispute if it does not meet the criteria.`
          : `All ${allowed} rounds of changes agreed for this milestone are used. Approve the delivery, or talk to the seller about a refund (only the seller can refund).`,
      );
    }
  } else if (deal.status !== "Proposed" || deal.offeredBy !== "them") {
    throw new NoteError("A revision can be asked for only on an offer from the seller that is still open");
  }
  return db.dealNote.create({ data: { escrow: config.fileEscrowOf(id), dealId: id, index: index ?? null, kind, author: "buyer", text } });
}
