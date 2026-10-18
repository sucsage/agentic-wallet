import "server-only";

import { type Address, getAddress } from "viem";

import { DealError, dealForWallet, dealTerms } from "./bank/deals";
import { db } from "./db";

/**
 * Files the creator of a deal attaches for the other side (a spec, a catalogue, a sample or a
 * quotation): kept with the deal's draft, readable by both parties of the deal on-chain, including
 * an outsider through their private link (each has a wallet that is a party). Only the creator adds
 * or removes them. Not part of the signed terms: the terms hash does not change.
 */

export const MAX_DEAL_FILES = 5;
export const MAX_DEAL_FILE_BYTES = 4 * 1024 * 1024;

export class DealFileError extends Error {}

/** The deal's draft, after checking that `wallet` is one of its two parties. */
async function draftFor(wallet: Address, dealId: number) {
  const deal = await dealForWallet(wallet, dealId);
  const buyer = deal.role === "buyer" ? wallet : getAddress(deal.counterparty);
  const seller = deal.role === "seller" ? wallet : getAddress(deal.counterparty);
  const draft = await dealTerms(dealId, buyer, seller);
  return { deal, draft };
}

export async function listDealFiles(wallet: Address, dealId: number, userId: string | null) {
  const { draft } = await draftFor(wallet, dealId);
  if (!draft) return { canAdd: false, files: [] };
  const files = await db.dealFile.findMany({ where: { draftId: draft.id }, orderBy: { createdAt: "asc" }, omit: { data: true } });
  return {
    canAdd: userId !== null && draft.userId === userId,
    files: files.map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, at: f.createdAt, mine: userId !== null && f.userId === userId })),
  };
}

export async function addDealFile(userId: string, wallet: Address, dealId: number, file: { name: string; mime: string; bytes: Buffer }) {
  const { draft, deal } = await draftFor(wallet, dealId);
  if (!draft || draft.userId !== userId) throw new DealFileError("Only the person who created this deal can attach files to it");
  if (deal.status === "Cancelled") throw new DealFileError("This deal was withdrawn");
  if (file.bytes.length > MAX_DEAL_FILE_BYTES) throw new DealFileError("Files up to 4 MB");
  if ((await db.dealFile.count({ where: { draftId: draft.id } })) >= MAX_DEAL_FILES) throw new DealFileError(`Up to ${MAX_DEAL_FILES} files per deal: remove one first`);
  const row = await db.dealFile.create({
    data: { draftId: draft.id, userId, name: file.name.slice(0, 200) || "file", mime: file.mime.slice(0, 100) || "application/octet-stream", size: file.bytes.length, data: new Uint8Array(file.bytes) },
  });
  return { id: row.id };
}

export async function removeDealFile(userId: string, wallet: Address, dealId: number, fileId: string) {
  const { draft } = await draftFor(wallet, dealId);
  const gone = await db.dealFile.deleteMany({ where: { id: fileId, draftId: draft?.id ?? "-", userId } });
  if (!gone.count) throw new DealFileError("File not found");
}

export async function readDealFile(wallet: Address, dealId: number, fileId: string) {
  const { draft } = await draftFor(wallet, dealId);
  const f = draft ? await db.dealFile.findFirst({ where: { id: fileId, draftId: draft.id } }) : null;
  if (!f) throw new DealFileError("File not found");
  return { name: f.name, mime: f.mime, bytes: Buffer.from(f.data) };
}

/**
 * A safe response for a stored file: images and PDFs open in the browser (and in this app's own
 * preview frame), anything else downloads. Never runs: images get a sandbox CSP; a PDF cannot (the
 * browser's PDF viewer refuses sandboxed documents), so it gets no script, no network and no
 * framing by other sites instead.
 */
export function fileResponse(f: { name: string; mime: string; bytes: Buffer }) {
  const pdf = f.mime === "application/pdf" && f.bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  const image = /^image\/(png|jpeg|webp|gif)$/.test(f.mime);
  const inline = pdf || image;
  return new Response(new Uint8Array(f.bytes), {
    headers: {
      "content-type": inline ? f.mime : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": pdf ? "default-src 'none'; object-src 'none'; frame-ancestors 'self'" : "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
      "cache-control": "private, no-store",
    },
  });
}

export const asDealFileHttp = (e: unknown) => e instanceof DealFileError || e instanceof DealError;
