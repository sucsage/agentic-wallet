import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { after } from "next/server";
import { type Address, type Hex, decodeEventLog, encodeFunctionData, getAddress, keccak256, toHex } from "viem";

import { agentWalletAbi, fileEscrowAbi, mockTHBAbi } from "../abis";
import { type TxOutcome, atFreshBlock, publicClient, roleAddresses, send } from "../chain";
import { config } from "../config";
import { db } from "../db";
import { type FileDealView, readFileDeals, walletUnits } from "../state";
import { fileTypeOk, fileTypesLabel } from "../file-types";
import { CARRIER_LABEL, type Carrier, bookParcel, checkTracking, deliveredShippedAt, trackParcel } from "../post";
import { type DraftMilestone, deliveryOf } from "./drafts";
import { type Mandate, mintCapError, ownerSignMandate } from "./funding";
import { arbitrate } from "./arbiter";
import { sweepInvite } from "./invites";
import { coverShortfall } from "./stripe-link";
import { TopupError } from "./topup";
import { InsufficientFunds, accountOf, openAccount, reserveIdFor, transfer } from "./ledger";

/**
 * File deals after the lock, for both sides:
 *   buyer:  approve, dispute, reclaim, cancel
 *   buyer:  accept a seller's offer, paying in from the bank just in time (acceptAndPay)
 *   seller: offer work (offerToSell), withdraw that offer, accept a buyer's offer, deliver (file + evidence), refund; the key release and the
 *           claim run on their own once the buyer approves and the windows pass (the agent's job)
 * plus the demo contractor (a server-run seller) and settlement back to the Mock Bank.
 *
 * Every wallet move is the user's click signed as an owner mandate (one transaction), except the
 * agent's own Tier 2 approval within its caps.
 *
 * Files: the seller's file is encrypted (AES-256-GCM) and kept in the database; only its sha256
 * goes on-chain as the work hash, so the buyer can check the file they finally get. The key stays
 * with the server (demo custody) and the chain gets a commitment to it at releaseKey; the buyer can
 * download the file only once the escrow shows the key as released.
 *
 * Settlement keeps the bank and the chain equal: tokens that leave escrow are redeemed (burned) and
 * the same amount moves out of the reserve, to the seller (PAYOUT) or back to the buyer (REFUND).
 * Redeem ids come from the deal and milestone, so a retry can never pay twice.
 */

const KIND_CALL = 2;
/** Vercel caps request bodies at 4.5 MB; keep uploads under it. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export class DealError extends Error {}

/** The escrow holding deal `dealId`; new deals are always made on the current one. */
const escrow = (dealId: number) => config.fileEscrowOf(dealId);
const currentEscrow = () => config.bankContracts.fileEscrow;

async function getDeal(dealId: number) {
  return atFreshBlock((blockNumber) =>
    publicClient().readContract({ address: escrow(dealId), abi: fileEscrowAbi, functionName: "getDeal", args: [BigInt(dealId)], blockNumber }),
  );
}

async function getMilestone(dealId: number, index: number) {
  return atFreshBlock((blockNumber) =>
    publicClient().readContract({
      address: escrow(dealId),
      abi: fileEscrowAbi,
      functionName: "getMilestone",
      args: [BigInt(dealId), BigInt(index)],
      blockNumber,
    }),
  );
}

/** A FileEscrow deal the wallet is party to (as buyer or seller), or a 404-style error. */
export async function dealForWallet(wallet: Address, dealId: number): Promise<FileDealView> {
  const deal = (await readFileDeals(wallet)).find((d) => d.id === dealId);
  if (!deal) throw new DealError("Deal not found for this wallet");
  return deal;
}

/** Sends one call from the wallet (to FileEscrow unless `target` says otherwise), approved by the
 *  owner's signature (the user's click). The wallet checks it against its policy either way. */
async function viaMandate(wallet: Address, data: Hex, reason: string, target: Address): Promise<TxOutcome> {
  const random = crypto.getRandomValues(new Uint32Array(2));
  const mandate: Mandate = {
    kind: KIND_CALL,
    target,
    amount: 0n,
    index: 0n,
    data,
    reasonHash: keccak256(toHex(reason)),
    nonce: (BigInt(random[0]) << 32n) | BigInt(random[1]),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  };
  const signature = await ownerSignMandate(wallet, mandate);
  return send("agent", { address: wallet, abi: agentWalletAbi, functionName: "executeMandate", args: [mandate, signature] });
}

const dealCall = (fn: "accept" | "cancel", dealId: number) =>
  encodeFunctionData({ abi: fileEscrowAbi, functionName: fn, args: [BigInt(dealId)] });
const milestoneCall = (fn: "approve" | "dispute" | "reclaim" | "claim" | "refund", dealId: number, index: number) =>
  encodeFunctionData({ abi: fileEscrowAbi, functionName: fn, args: [BigInt(dealId), BigInt(index)] });

// ------------------------------------------------------------------------------------------
// Buyer moves
// ------------------------------------------------------------------------------------------

export type BuyerAction = "approve" | "dispute" | "reclaim" | "cancel";

/**
 * Runs a buyer move through the wallet. Approving a delivery first tries the agent's own path
 * (Tier 2: within its caps and allowlist, recorded as AgentFileApproved); above the caps it falls
 * back to the owner's signed mandate, like every other move here.
 */
export async function buyerAction(
  wallet: Address,
  dealId: number,
  action: BuyerAction,
  index = 0,
): Promise<{ tier: 1 | 2; outcome: TxOutcome }> {
  const deal = await dealForWallet(wallet, dealId);
  if (deal.role !== "buyer") throw new DealError("Only the buyer can do this");

  // The agent approves only a fresh delivery. Wallets made before the DC-H-01 fix do not check
  // this on-chain, so the server checks it for them: confirming a released key is the buyer's click.
  if (action === "approve" && deal.milestones[index]?.status === "Delivered") {
    const agent = await send("agent", {
      address: wallet,
      abi: agentWalletAbi,
      functionName: "agentApproveFile",
      args: [escrow(dealId), BigInt(dealId), BigInt(index)],
    });
    if (agent.status === "success") return { tier: 2, outcome: agent };
    // Only a definite refusal (e.g. over the caps) falls back; a network error is reported as is.
    if (!(agent.status === "rejected" && agent.definite)) return { tier: 2, outcome: agent };
  }
  const data = action === "cancel" ? dealCall("cancel", dealId) : milestoneCall(action, dealId, index);
  return { tier: 1, outcome: await viaMandate(wallet, data, `${action} deal ${dealId} milestone ${index}`, escrow(dealId)) };
}

// ------------------------------------------------------------------------------------------
// Seller moves
// ------------------------------------------------------------------------------------------

export type SellerAction = "accept" | "claim" | "refund" | "cancel";

export async function sellerAction(wallet: Address, dealId: number, action: SellerAction, index = 0): Promise<{ tier: 1; outcome: TxOutcome }> {
  const deal = await dealForWallet(wallet, dealId);
  if (deal.role !== "seller") throw new DealError("Only the seller can do this");
  const data = action === "accept" || action === "cancel" ? dealCall(action, dealId) : milestoneCall(action, dealId, index);
  return { tier: 1, outcome: await viaMandate(wallet, data, `${action} deal ${dealId} milestone ${index}`, escrow(dealId)) };
}

/** The seller's offer goes on-chain. It locks nothing; the deal id comes from the receipt. */
export async function offerToSell(
  wallet: Address,
  offer: { buyer: Address; milestones: { amount: bigint; hasFile: boolean }[]; reviewPeriod: bigint; termsURI: string; reason: string },
): Promise<{ outcome: TxOutcome; dealId?: number }> {
  const { address: token } = await walletUnits(wallet);
  const terms = offer.milestones.map((m) => ({ amount: m.amount, hasFile: m.hasFile, workHash: `0x${"0".repeat(64)}` as Hex }));
  const data = encodeFunctionData({
    abi: fileEscrowAbi,
    functionName: "offerToSell",
    args: [offer.buyer, config.arbiter, token, terms, offer.reviewPeriod, offer.termsURI],
  });
  const outcome = await viaMandate(wallet, data, offer.reason, currentEscrow());
  if (outcome.status !== "success") return { outcome };
  const receipt = await publicClient().getTransactionReceipt({ hash: outcome.hash });
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== currentEscrow()) continue;
    try {
      const event = decodeEventLog({ abi: fileEscrowAbi, data: log.data, topics: log.topics });
      if (event.eventName === "OfferCreated") return { outcome, dealId: Number(event.args.dealId) };
    } catch {
      // another event from the escrow
    }
  }
  return { outcome };
}

export type AcceptResult = {
  status: "FUNDED" | "REFUNDED" | "PENDING";
  dealId: number;
  steps: { step: "debit" | "mint" | "approve" | "accept" | "refund"; outcome?: TxOutcome; done?: true }[];
  error?: string;
};

/** Mined and reverted, or refused by the contract before sending: it did not and will not happen. */
const certainFailure = (o: TxOutcome) => o.status === "reverted" || (o.status === "rejected" && o.definite === true);

/**
 * The buyer accepts a seller's offer and pays in just in time, like fundJustInTime for a buyer's
 * own offer: debit the bank, mint the same amount into the wallet, approve the escrow and accept,
 * which locks it. Every step is keyed by the deal, so pressing again resumes instead of paying
 * twice. If the accept certainly failed, the minted tokens are burned and the bank is refunded.
 */
export async function acceptAndPay(wallet: Address, dealId: number): Promise<AcceptResult> {
  const d = await getDeal(dealId);
  if (getAddress(d.buyer) !== wallet) throw new DealError("Only the buyer can accept this offer");
  const steps: AcceptResult["steps"] = [];
  const done = (status: AcceptResult["status"], error?: string): AcceptResult => ({ status, dealId, steps, error });
  if (d.status === 1) return done("FUNDED");
  if (d.status !== 0) throw new DealError("This offer is no longer open");
  if (getAddress(d.creator) === wallet) throw new DealError("You made this offer; the seller accepts it");
  const seller = getAddress(d.seller);
  const allowed = await publicClient().readContract({ address: wallet, abi: agentWalletAbi, functionName: "allowedRecipient", args: [seller] });
  if (!allowed) throw new DealError("Add the seller as a payee first (Friends → Make payee)");
  const units = await walletUnits(wallet);
  const account = await accountOf(wallet);
  if (!account || !units.currency) throw new DealError("This wallet has no Mock Bank account");
  if (getAddress(d.token) !== units.address) throw new DealError("This offer is in another currency");
  const { address: token, currency } = units;
  const id = redeemId("accept", dealId);

  // 1. Debit: the transfer row is the funding record, written before anything happens on-chain.
  // A short balance is covered from the linked Stripe card first (once per deal).
  if (!(await db.bankTransfer.findUnique({ where: { idempotencyKey: `accept:${id}:debit` } }))) {
    const capError = await mintCapError(token, d.total, currency);
    if (capError) throw new DealError(capError);
    await coverShortfall(wallet, d.total, `accept:${id}`).catch((e) => {
      throw e instanceof TopupError ? new DealError(e.message) : e;
    });
  }
  try {
    await transfer({ key: `accept:${id}:debit`, kind: "FUND", fromId: account.id, toId: reserveIdFor(currency), amount: d.total });
  } catch (err) {
    if (err instanceof InsufficientFunds) throw new DealError("Not enough money in your bank account");
    throw err;
  }
  steps.push({ step: "debit" });

  // 2. Mint the same amount into the wallet; the id makes a second mint impossible.
  const minted = () =>
    atFreshBlock((blockNumber) => publicClient().readContract({ address: token, abi: mockTHBAbi, functionName: "minted", args: [id], blockNumber }));
  if (await minted()) {
    steps.push({ step: "mint", done: true });
  } else {
    const mint = await send("bank", { address: token, abi: mockTHBAbi, functionName: "mint", args: [wallet, d.total, id] });
    steps.push({ step: "mint", outcome: mint });
    if (mint.status !== "success" && !(await minted())) {
      if (!certainFailure(mint)) return done("PENDING", "error" in mint ? mint.error : undefined);
      await transfer({ key: `accept:${id}:refund`, kind: "REFUND", fromId: reserveIdFor(currency), toId: account.id, amount: d.total });
      steps.push({ step: "refund" });
      return done("REFUNDED", "error" in mint ? mint.error : undefined);
    }
  }

  // 3. Approve and accept: the wallet checks the seller is a payee, the token and the arbiter.
  const approve = await viaMandate(
    wallet,
    encodeFunctionData({ abi: mockTHBAbi, functionName: "approve", args: [escrow(dealId), d.total] }),
    `approve deal ${dealId}`,
    token,
  );
  steps.push({ step: "approve", outcome: approve });
  const accept = await viaMandate(wallet, dealCall("accept", dealId), `accept deal ${dealId}`, escrow(dealId));
  steps.push({ step: "accept", outcome: accept });
  if ((await getDeal(dealId)).status === 1) return done("FUNDED");
  const failed = certainFailure(accept) ? accept : certainFailure(approve) ? approve : null;
  if (!failed) return done("PENDING", "error" in accept ? accept.error : undefined);

  // 4. Undo: burn what was minted for this deal and give the money back.
  await settleToWalletBank(wallet, token, currency, id, d.total, "REFUND");
  steps.push({ step: "refund" });
  return done("REFUNDED", "error" in failed ? failed.error : undefined);
}

/**
 * The seller delivers a milestone: the file (if any) is encrypted and stored, the evidence note is
 * kept with it, and the work hash (sha256 of the file, or of the note when there is no file) is
 * anchored on-chain. Delivering again before the buyer approves replaces the previous delivery.
 */
export async function deliver(
  userId: string,
  wallet: Address,
  dealId: number,
  index: number,
  input: {
    note: string;
    file: { name: string; mime: string; bytes: Buffer } | null;
    /** Parcel milestones: book with Mock Post (no tracking given) or record another carrier's number. */
    parcel?: { carrier: Carrier; tracking?: string } | null;
  },
): Promise<{ outcome: TxOutcome; sha256: string; tracking?: string }> {
  const deal = await dealForWallet(wallet, dealId);
  if (deal.role !== "seller") throw new DealError("Only the seller delivers");
  const m = deal.milestones[index];
  if (!m) throw new DealError("No such milestone");
  if (m.status !== "Pending" && m.status !== "Delivered") throw new DealError(`This milestone is already ${m.status}`);
  const terms = await dealTerms(dealId, getAddress(deal.counterparty), wallet);
  const agreed = (terms?.milestones as DraftMilestone[] | undefined)?.[index];
  const parcelMilestone = deliveryOf(agreed) === "parcel";
  if (input.file && !fileTypeOk(input.file.name, agreed?.fileTypes)) {
    throw new DealError(`This milestone accepts only ${fileTypesLabel(agreed?.fileTypes)} files (agreed in the deal). "${input.file.name}" is not one of them.`);
  }
  if (parcelMilestone && !input.parcel) throw new DealError("This milestone ships a parcel: book it with Mock Post or enter the tracking number");
  if (m.hasFile && !input.file) throw new DealError("This milestone needs a file");
  if (!input.file && !input.parcel && !input.note.trim()) throw new DealError("Describe what you delivered");
  if (input.file && input.file.bytes.length > MAX_FILE_BYTES) throw new DealError("The file is larger than 4 MB");

  // A parcel: the tracking record is the evidence, and its hash the work hash on-chain.
  let parcel: { carrier: Carrier; tracking: string; shippedAt: Date } | null = null;
  if (input.parcel) {
    const carrier = input.parcel.carrier;
    const tracking = carrier === "MOCK_POST" && !input.parcel.tracking ? bookParcel() : (input.parcel.tracking ?? "").trim().toUpperCase();
    const bad = checkTracking(carrier, tracking);
    if (bad) throw new DealError(bad);
    const prior = await db.dealDelivery.findUnique({ where: { escrow_dealId_index: { escrow: escrow(dealId), dealId, index } } });
    parcel = { carrier, tracking, shippedAt: prior?.tracking === tracking && prior.shippedAt ? prior.shippedAt : new Date() };
    if (!input.note.trim()) input = { ...input, note: `Shipped with ${CARRIER_LABEL[carrier]}, tracking number ${tracking}.` };
  }

  const plain =
    input.file?.bytes ??
    Buffer.from(parcel ? JSON.stringify({ carrier: parcel.carrier, tracking: parcel.tracking, note: input.note }) : input.note, "utf8");
  const sha256 = createHash("sha256").update(plain).digest("hex");
  let enc: { ciphertext: Buffer; iv: Buffer; tag: Buffer; key: Buffer } | null = null;
  if (input.file) {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([c.update(input.file.bytes), c.final()]);
    enc = { ciphertext, iv, tag: c.getAuthTag(), key };
  }
  const row = await db.dealDelivery.upsert({
    where: { escrow_dealId_index: { escrow: escrow(dealId), dealId, index } },
    update: {
      sellerUserId: userId,
      note: input.note,
      fileName: input.file?.name ?? null,
      mime: input.file?.mime ?? null,
      size: input.file?.bytes.length ?? null,
      ciphertext: enc ? new Uint8Array(enc.ciphertext) : null,
      iv: enc?.iv.toString("hex") ?? null,
      tag: enc?.tag.toString("hex") ?? null,
      fileKey: enc?.key.toString("hex") ?? null,
      carrier: parcel?.carrier ?? null,
      tracking: parcel?.tracking ?? null,
      shippedAt: parcel?.shippedAt ?? null,
      sha256,
    },
    create: {
      escrow: escrow(dealId),
      dealId,
      index,
      sellerUserId: userId,
      note: input.note,
      fileName: input.file?.name ?? null,
      mime: input.file?.mime ?? null,
      size: input.file?.bytes.length ?? null,
      ciphertext: enc ? new Uint8Array(enc.ciphertext) : null,
      iv: enc?.iv.toString("hex") ?? null,
      tag: enc?.tag.toString("hex") ?? null,
      fileKey: enc?.key.toString("hex") ?? null,
      carrier: parcel?.carrier ?? null,
      tracking: parcel?.tracking ?? null,
      shippedAt: parcel?.shippedAt ?? null,
      sha256,
    },
  });
  const data = encodeFunctionData({
    abi: fileEscrowAbi,
    functionName: "deliver",
    args: [BigInt(dealId), BigInt(index), `0x${sha256}`, `app-delivery:${row.id}`],
  });
  return { outcome: await viaMandate(wallet, data, `deliver deal ${dealId} milestone ${index}`, escrow(dealId)), sha256, tracking: parcel?.tracking };
}

/** What either party may see about a delivery before the file itself. */
export async function deliveryInfo(dealId: number, index: number) {
  const d = await db.dealDelivery.findUnique({ where: { escrow_dealId_index: { escrow: escrow(dealId), dealId, index } } });
  if (!d) return null;
  const parcel =
    d.tracking && d.carrier && d.shippedAt
      ? { carrier: d.carrier, carrierLabel: CARRIER_LABEL[d.carrier as Carrier] ?? d.carrier, tracking: d.tracking, ...trackParcel(d.carrier as Carrier, d.shippedAt) }
      : null;
  return { note: d.note, fileName: d.fileName, mime: d.mime, size: d.size, sha256: d.sha256, deliveredAt: d.updatedAt, parcel };
}

/**
 * Test mode: a Mock Post parcel arrives now instead of moving one stage a minute, so a demo does
 * not wait. Either side of the deal may press it; real carriers are never touched.
 */
export async function arriveParcelNow(wallet: Address, dealId: number, index: number) {
  await dealForWallet(wallet, dealId);
  const d = await db.dealDelivery.findUnique({ where: { escrow_dealId_index: { escrow: escrow(dealId), dealId, index } } });
  if (!d?.shippedAt || d.carrier !== "MOCK_POST") throw new DealError("Only a Mock Post parcel can be delivered instantly (test mode)");
  await db.dealDelivery.update({ where: { id: d.id }, data: { shippedAt: deliveredShippedAt() } });
}

/** The decrypted file: always for the seller, for the buyer only once the escrow released the key. */
export async function deliveryFile(wallet: Address, dealId: number, index: number) {
  const deal = await dealForWallet(wallet, dealId);
  const status = deal.milestones[index]?.status;
  if (deal.role === "buyer" && status !== "KeyReleased" && status !== "Released" && status !== "Split") {
    throw new DealError("The file unlocks after you approve the work and the seller releases the key");
  }
  const d = await db.dealDelivery.findUnique({ where: { escrow_dealId_index: { escrow: escrow(dealId), dealId, index } } });
  if (!d?.ciphertext || !d.fileKey || !d.iv || !d.tag) throw new DealError("No file for this milestone");
  const dec = createDecipheriv("aes-256-gcm", Buffer.from(d.fileKey, "hex"), Buffer.from(d.iv, "hex"));
  dec.setAuthTag(Buffer.from(d.tag, "hex"));
  const bytes = Buffer.concat([dec.update(Buffer.from(d.ciphertext)), dec.final()]);
  return { bytes, name: d.fileName ?? "delivery", mime: d.mime ?? "application/octet-stream", sha256: d.sha256 };
}

/** Stroke glyphs for the watermark: drawn as paths, so it needs no fonts on the server. */
const GLYPH: Record<string, string> = {
  P: "M0 14V0H7L10 3V5L7 8H0",
  R: "M0 14V0H7L10 3V5L7 8H0M5 8L10 14",
  E: "M10 0H0V14H10M0 7H7",
  V: "M0 0L5 14L10 0",
  I: "M5 0V14M2 0H8M2 14H8",
  W: "M0 0L2.5 14L5 5L7.5 14L10 0",
};

function watermarkSvg(width: number, height: number): string {
  const word = "PREVIEW";
  const path = [...word].map((ch, i) => `<path transform="translate(${i * 14} 0)" d="${GLYPH[ch]}"/>`).join("");
  const scale = Math.max(1.2, Math.min(width, height) / 160);
  const tileW = 130 * scale;
  const tileH = 60 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><pattern id="w" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
<g transform="translate(${8 * scale} ${20 * scale}) scale(${scale})" fill="none" stroke-linecap="round" stroke-linejoin="round">
<g stroke="#000" stroke-opacity="0.35" stroke-width="3.2">${path}</g>
<g stroke="#fff" stroke-opacity="0.7" stroke-width="1.6">${path}</g>
</g></pattern></defs>
<rect width="100%" height="100%" fill="url(#w)"/></svg>`;
}

/**
 * A watermarked, downscaled copy of a delivered image, for the buyer to check before approving.
 * The original stays encrypted until the key is released; the preview is too small and too
 * marked to stand in for it.
 */
export async function deliveryPreview(wallet: Address, dealId: number, index: number): Promise<Buffer> {
  await dealForWallet(wallet, dealId);
  const d = await db.dealDelivery.findUnique({ where: { escrow_dealId_index: { escrow: escrow(dealId), dealId, index } } });
  if (!d?.ciphertext || !d.fileKey || !d.iv || !d.tag) throw new DealError("No file for this milestone");
  if (!d.mime?.startsWith("image/")) throw new DealError("Previews are made for images only");
  const dec = createDecipheriv("aes-256-gcm", Buffer.from(d.fileKey, "hex"), Buffer.from(d.iv, "hex"));
  dec.setAuthTag(Buffer.from(d.tag, "hex"));
  const bytes = Buffer.concat([dec.update(Buffer.from(d.ciphertext)), dec.final()]);
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  return sharp(data)
    .composite([{ input: Buffer.from(watermarkSvg(info.width, info.height)) }])
    .jpeg({ quality: 55 })
    .toBuffer();
}

/** A delivered web page (an .html file): previewed inside a device mockup before approval. */
export const isSiteDelivery = (d: { mime: string | null; fileName: string | null } | null | undefined) =>
  Boolean(d && (d.mime === "text/html" || /\.html?$/i.test(d.fileName ?? "")));

/**
 * A delivered website for the buyer to try before approving, shown in a browser / phone mockup.
 * It is served sandboxed (no cookies, no same-origin access, no network except images, styles and
 * fonts) with a PREVIEW ribbon on top. Like an image preview, it is meant to judge the work, not to
 * replace the file the key unlocks.
 */
export async function deliverySite(wallet: Address | null, dealId: number, index: number): Promise<string> {
  if (wallet) await dealForWallet(wallet, dealId);
  const d = await db.dealDelivery.findUnique({ where: { escrow_dealId_index: { escrow: escrow(dealId), dealId, index } } });
  if (!d?.ciphertext || !d.fileKey || !d.iv || !d.tag) throw new DealError("No file for this milestone");
  if (!isSiteDelivery(d)) throw new DealError("Mockup previews are made for web pages (.html) only");
  const dec = createDecipheriv("aes-256-gcm", Buffer.from(d.fileKey, "hex"), Buffer.from(d.iv, "hex"));
  dec.setAuthTag(Buffer.from(d.tag, "hex"));
  const html = Buffer.concat([dec.update(Buffer.from(d.ciphertext)), dec.final()]).toString("utf8");
  const ribbon =
    '<div style="position:fixed;z-index:2147483647;top:10px;right:-38px;transform:rotate(35deg);background:#e11d48;color:#fff;font:700 12px/1 system-ui,sans-serif;padding:6px 44px;letter-spacing:.12em;pointer-events:none;box-shadow:0 2px 8px #0005">PREVIEW</div>';
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${ribbon}</body>`) : `${html}${ribbon}`;
}

/** Headers for a sandboxed site preview. Framing is limited to this app by X-Frame-Options (proxy.ts): CSP frame-ancestors cannot say so here, since the sandbox gives the page no origin. */
export const SITE_PREVIEW_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "content-security-policy":
    "sandbox allow-scripts allow-forms; default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline' https:; font-src data: https:; script-src 'unsafe-inline'",
  "x-content-type-options": "nosniff",
};

// ------------------------------------------------------------------------------------------
// Settlement and the automatic steps (demo contractor, key release, claim)
// ------------------------------------------------------------------------------------------

/** The demo file's plaintext for a milestone; its sha256 is the work hash anchored on-chain. */
function demoFile(dealId: number, index: number): string {
  return `Agentic Wallet demo deliverable · deal ${dealId} · milestone ${index + 1}`;
}

export function demoDeliverable(dealId: number, index: number) {
  const text = demoFile(dealId, index);
  return { text, sha256: createHash("sha256").update(text).digest("hex") };
}

const redeemId = (kind: "payout" | "refund" | "cancel" | "accept", dealId: number, index = 0): Hex =>
  keccak256(toHex(`${kind}:${config.chain.id}:${escrow(dealId)}:${dealId}:${index}`));

async function redeemed(token: Address, holder: Address, id: Hex): Promise<boolean> {
  return atFreshBlock((blockNumber) =>
    publicClient().readContract({ address: token, abi: mockTHBAbi, functionName: "redeemed", args: [holder, id], blockNumber }),
  );
}

/** Burns tokens a user wallet received from escrow and credits the same amount to its bank account. */
async function settleToWalletBank(
  wallet: Address,
  token: Address,
  currency: "THB" | "CNY",
  id: Hex,
  amount: bigint,
  kind: "REFUND" | "PAYOUT",
) {
  const account = await accountOf(wallet);
  if (!account) return;
  if (!(await redeemed(token, wallet, id))) {
    const out = await send("owner", {
      address: wallet,
      abi: agentWalletAbi,
      functionName: "execute",
      args: [token, 0n, encodeFunctionData({ abi: mockTHBAbi, functionName: "redeem", args: [amount, id] })],
    });
    if (out.status !== "success" && !(await redeemed(token, wallet, id))) return;
  }
  await transfer({ key: `${kind.toLowerCase()}:${id}`, kind, fromId: reserveIdFor(currency), toId: account.id, amount });
}

/** Burns `amount` held by the demo contractor and pays the contractor's bank account. */
async function payoutContractor(token: Address, currency: "THB" | "CNY", dealId: number, index: number, amount: bigint) {
  const id = redeemId("payout", dealId, index);
  const contractor = roleAddresses().contractor;
  if (!(await redeemed(token, contractor, id))) {
    const out = await send("contractor", { address: token, abi: mockTHBAbi, functionName: "redeem", args: [amount, id] });
    if (out.status !== "success" && !(await redeemed(token, contractor, id))) return;
  }
  const account = await openAccount(contractor, "Demo contractor", currency);
  await transfer({ key: `payout:${id}`, kind: "PAYOUT", fromId: reserveIdFor(currency), toId: account.id, amount });
}

const syncing = new Map<number, Promise<void>>();

/**
 * Moves a deal forward where the server owes a step: the demo contractor's moves, a user seller's
 * key release and claim, and bank settlement on both sides. Safe from any request: concurrent calls
 * for the same deal share one run, and every step re-reads the chain first.
 */
/**
 * syncDeal after the response, kept alive until it finishes (on Vercel a bare promise is cut off when
 * the response is sent, so a deposit due on signing would wait for the next visit). Outside a request
 * (scripts) it just runs.
 */
export function syncDealLater(wallet: Address, dealId: number): void {
  const run = () => syncDeal(wallet, dealId).catch((e) => console.error("syncDeal", dealId, e));
  try {
    after(run);
  } catch {
    void run();
  }
}

export function syncDeal(_wallet: Address, dealId: number): Promise<void> {
  const running = syncing.get(dealId);
  if (running) return running;
  const run = doSync(dealId).finally(() => syncing.delete(dealId));
  syncing.set(dealId, run);
  return run;
}

async function doSync(dealId: number): Promise<void> {
  const d = await getDeal(dealId);
  const buyer = getAddress(d.buyer);
  const seller = getAddress(d.seller);
  const contractor = roleAddresses().contractor;
  const demoSeller = seller === contractor;
  const sellerIsUser = !demoSeller && (await accountOf(seller)) !== null;
  const buyerIsUser = (await accountOf(buyer)) !== null;
  const units = await walletUnits(buyerIsUser ? buyer : seller);
  if (!units.currency) return;
  const { address: token, currency } = units;
  const now = BigInt(Math.floor(Date.now() / 1000));

  // The offer was withdrawn before acceptance: the whole total went back to the buyer.
  if (d.status === 2) {
    if (buyerIsUser && getAddress(d.creator) === buyer) await settleToWalletBank(buyer, token, currency, redeemId("cancel", dealId), d.total, "REFUND");
    return;
  }
  if (d.status === 0) {
    if (demoSeller) await send("contractor", { address: escrow(dealId), abi: fileEscrowAbi, functionName: "accept", args: [BigInt(dealId)] });
    return;
  }

  for (let i = 0; i < Number(d.milestoneCount); i++) {
    const m = await getMilestone(dealId, i);
    const open = now <= m.deadline;
    switch (m.status) {
      case 0: // Pending: the demo contractor delivers one milestone at a time; users deliver themselves
        if (demoSeller) {
          const workHash = `0x${createHash("sha256").update(demoFile(dealId, i)).digest("hex")}` as Hex;
          await send("contractor", {
            address: escrow(dealId),
            abi: fileEscrowAbi,
            functionName: "deliver",
            args: [BigInt(dealId), BigInt(i), workHash, `demo-delivery:${dealId}:${i}`],
          });
        } else if (i === 0 && sellerIsUser && buyerIsUser && (await payDepositOnSigning(dealId, buyer, seller))) {
          return doSync(dealId); // the deposit is approved now: release and settle it in this run
        }
        return;
      case 1: // Delivered: the buyer reviews; after a silent window the seller moves on
        // A deposit whose approval did not go through on signing: approve it now.
        if (i === 0 && open && sellerIsUser && buyerIsUser && (await payDepositOnSigning(dealId, buyer, seller, true))) return doSync(dealId);
        if (!open) {
          if (demoSeller) {
            await (m.hasFile
              ? send("contractor", { address: escrow(dealId), abi: fileEscrowAbi, functionName: "releaseKey", args: [BigInt(dealId), BigInt(i), toHex(randomBytes(32))] })
              : send("contractor", { address: escrow(dealId), abi: fileEscrowAbi, functionName: "claim", args: [BigInt(dealId), BigInt(i)] }));
          } else if (sellerIsUser) {
            await (m.hasFile ? releaseKeyFor(seller, dealId, i) : viaMandate(seller, milestoneCall("claim", dealId, i), `claim ${dealId}/${i}`, escrow(dealId)));
          }
        }
        return;
      case 2: // Approved: hand over the key, then confirm it for the buyer
        if (demoSeller) {
          await send("contractor", { address: escrow(dealId), abi: fileEscrowAbi, functionName: "releaseKey", args: [BigInt(dealId), BigInt(i), toHex(randomBytes(32))] });
        } else if (sellerIsUser) {
          const out = await releaseKeyFor(seller, dealId, i);
          if (out.status === "success" && buyerIsUser && (await confirmKeyFor(buyer, dealId, i))) {
            await settleToWalletBank(seller, token, currency, redeemId("payout", dealId, i), m.amount, "PAYOUT");
            await sweepInvite(seller);
          }
        }
        return;
      case 3: // KeyReleased: the buyer confirms a key that opens the file; else claim after the window
        if (open && buyerIsUser && sellerIsUser) {
          if (await confirmKeyFor(buyer, dealId, i)) {
            await settleToWalletBank(seller, token, currency, redeemId("payout", dealId, i), m.amount, "PAYOUT");
            await sweepInvite(seller);
          }
        } else if (!open) {
          if (demoSeller) {
            await send("contractor", { address: escrow(dealId), abi: fileEscrowAbi, functionName: "claim", args: [BigInt(dealId), BigInt(i)] });
          } else if (sellerIsUser) {
            await viaMandate(seller, milestoneCall("claim", dealId, i), `claim ${dealId}/${i}`, escrow(dealId));
          }
        }
        return;
      case 4: // Released: the seller was paid on-chain; settle it in the bank
        if (demoSeller) await payoutContractor(token, currency, dealId, i, m.amount);
        else if (sellerIsUser) {
          await settleToWalletBank(seller, token, currency, redeemId("payout", dealId, i), m.amount, "PAYOUT");
          await sweepInvite(seller);
        }
        continue;
      case 5: // Disputed: the neutral arbiter decides (mechanically for a key, AI for the work)
        if (await arbitrate(dealId, i)) {
          i--; // resolved on-chain: settle this milestone in the same run
          continue;
        }
        return;
      case 6: // Refunded: back to the buyer's bank
        if (buyerIsUser) await settleToWalletBank(buyer, token, currency, redeemId("refund", dealId, i), m.amount, "REFUND");
        continue;
      case 7: {
        // Split by the arbiter: the seller's share is paid out, the rest goes back to the buyer.
        const [toSeller, toBuyer] = await publicClient().readContract({
          address: escrow(dealId),
          abi: fileEscrowAbi,
          functionName: "splitOf",
          args: [BigInt(dealId), BigInt(i)],
        });
        if (demoSeller) await payoutContractor(token, currency, dealId, i, toSeller);
        else if (sellerIsUser) {
          await settleToWalletBank(seller, token, currency, redeemId("payout", dealId, i), toSeller, "PAYOUT");
          await sweepInvite(seller);
        }
        if (buyerIsUser) await settleToWalletBank(buyer, token, currency, redeemId("refund", dealId, i), toBuyer, "REFUND");
        continue;
      }
    }
  }
}

/**
 * A deposit (มัดจำ): the first milestone, marked deposit in the terms both sides saw, is paid as
 * soon as the offer is accepted, i.e. the contract is signed. The server (which holds both
 * wallets' keys in the demo) records a "paid on signing" delivery for the seller and approves it
 * for the buyer, as the accepted terms say. True when it was approved.
 */
async function payDepositOnSigning(dealId: number, buyer: Address, seller: Address, alreadyDelivered = false): Promise<boolean> {
  const terms = await dealTerms(dealId, buyer, seller);
  const first = (terms?.milestones as DraftMilestone[] | undefined)?.[0];
  if (!terms || !first?.deposit || first.hasFile) return false;
  const note = `Deposit paid on signing: "${first.name}", agreed in the terms (sha256:${terms.termsHash.slice(0, 12)}…).`;
  const sha256 = createHash("sha256").update(note).digest("hex");
  const sellerUser = (await db.userWallet.findFirst({ where: { walletAddress: seller } }))?.userId ?? terms.userId;
  const row = await db.dealDelivery.upsert({
    where: { escrow_dealId_index: { escrow: escrow(dealId), dealId, index: 0 } },
    update: {},
    create: { escrow: escrow(dealId), dealId, index: 0, sellerUserId: sellerUser, note, sha256 },
  });
  const delivered = alreadyDelivered
    ? ({ status: "success" } as const)
    : await viaMandate(
    seller,
    encodeFunctionData({ abi: fileEscrowAbi, functionName: "deliver", args: [BigInt(dealId), 0n, `0x${row.sha256}`, `app-delivery:${row.id}`] }),
    `deposit on signing, deal ${dealId}`,
    escrow(dealId),
  );
  if (delivered.status !== "success") {
    console.error("deposit deliver", dealId, delivered);
    return false;
  }
  const approved = await buyerAction(buyer, dealId, "approve", 0).catch((e) => {
    console.error("deposit approve", dealId, e);
    return null;
  });
  return approved?.outcome.status === "success";
}

/**
 * Releases the key for a user seller's file. The chain gets a commitment to the key (its keccak);
 * the server, which holds the key, serves the decrypted file to the buyer once this is on-chain.
 */
async function releaseKeyFor(seller: Address, dealId: number, index: number): Promise<TxOutcome> {
  const d = await db.dealDelivery.findUnique({ where: { escrow_dealId_index: { escrow: escrow(dealId), dealId, index } } });
  const commitment = d?.fileKey ? keccak256(`0x${d.fileKey}`) : keccak256(toHex(`no-file:${dealId}:${index}`));
  const data = encodeFunctionData({
    abi: fileEscrowAbi,
    functionName: "releaseKey",
    args: [BigInt(dealId), BigInt(index), commitment],
  });
  return viaMandate(seller, data, `releaseKey ${dealId}/${index}`, escrow(dealId));
}

/**
 * Confirms a released key for the buyer so the seller is paid at once. The server holds the key,
 * so it checks that it opens the file whose sha256 is the work hash on-chain; a key that does not
 * is left for the buyer to dispute inside the window. The buyer already approved the work, so this
 * spends nothing new (the owner's mandate path, not the agent's capped approval).
 */
async function confirmKeyFor(buyer: Address, dealId: number, index: number): Promise<boolean> {
  const m = await getMilestone(dealId, index);
  if (m.status !== 3) return false;
  const d = await db.dealDelivery.findUnique({ where: { escrow_dealId_index: { escrow: escrow(dealId), dealId, index } } });
  if (!d?.ciphertext || !d.fileKey || !d.iv || !d.tag) return false;
  try {
    const dec = createDecipheriv("aes-256-gcm", Buffer.from(d.fileKey, "hex"), Buffer.from(d.iv, "hex"));
    dec.setAuthTag(Buffer.from(d.tag, "hex"));
    const bytes = Buffer.concat([dec.update(Buffer.from(d.ciphertext)), dec.final()]);
    if (`0x${createHash("sha256").update(bytes).digest("hex")}` !== m.workHash.toLowerCase()) return false;
  } catch {
    return false;
  }
  const out = await viaMandate(buyer, milestoneCall("approve", dealId, index), `confirm key ${dealId}/${index}`, escrow(dealId));
  return out.status === "success";
}

/** Off-chain terms of a deal (title, milestone names), drafted by its buyer. Both parties see them. */
export async function dealTerms(dealId: number, buyer: Address, seller?: Address) {
  return db.dealDraft.findFirst({ where: { dealId, walletAddress: { in: seller ? [buyer, seller] : [buyer] } } });
}
