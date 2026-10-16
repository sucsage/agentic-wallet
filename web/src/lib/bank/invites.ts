import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { type Address, getAddress } from "viem";

import type { Currency, PayoutMethod, SellerInvite } from "@/generated/prisma/client";

import { createWorkspace } from "../actions";
import { agentWalletAbi } from "../abis";
import { type TxOutcome, send } from "../chain";
import { db } from "../db";
import { readFileDeals } from "../state";
import { accountOf, openAccount, transfer } from "./ledger";
import { OpnError, createRecipient, findTransfer, opnEnabled, recipient, sendTransfer } from "./opn";

/**
 * Sellers without an account. The buyer invites someone by name and gets a link; the server runs
 * an agent wallet for that person, so the contracts see an ordinary seller wallet and every step
 * (accept, deliver, key release, claim, bank payout) is the same code as for a signed-in seller.
 *
 * The link's secret is the only credential, so only its hash is stored. Whoever holds the link can
 * act as the seller, which is why the payout destination is set once and locked: a leaked link can
 * deliver work, but cannot redirect money that was already headed somewhere.
 *
 * Earnings land in the invited seller's demo bank account (PAYOUT, as for any seller) and are then
 * swept to the destination they chose (WITHDRAW): another Mock Bank account, whose holder's name
 * must match, or PromptPay / another bank, simulated by an EXTERNAL account per currency.
 */

export class InviteError extends Error {}

const LINK_DAYS = 30;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The invited seller's wallet, labelled for the buyer; null for any other address. */
export async function inviteLabels(userId: string): Promise<Map<string, string>> {
  const rows = await db.sellerInvite.findMany({ where: { userId }, select: { sellerWallet: true, name: true } });
  return new Map(rows.map((r) => [r.sellerWallet.toLowerCase(), `${r.name} (invited)`]));
}

export function listInvites(userId: string) {
  return db.sellerInvite.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

/**
 * Creates the seller's wallet and bank account, makes them a payee of the buyer's wallet (the
 * buyer's click is that approval) and returns the link's secret, shown to the buyer this once.
 */
export async function createInvite(
  userId: string,
  buyerWallet: Address,
  name: string,
): Promise<{ invite: SellerInvite; token: string; payee: TxOutcome }> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (clean.length < 2) throw new InviteError("Enter the seller's name");
  const buyerAccount = await accountOf(buyerWallet);
  if (!buyerAccount) throw new InviteError("Your wallet has no Mock Bank account");
  const currency = buyerAccount.currency;

  const { address: sellerWallet } = await createWorkspace({ currency });
  await openAccount(sellerWallet, `Invited seller · ${clean}`, currency);
  const payee = await send("owner", { address: buyerWallet, abi: agentWalletAbi, functionName: "setRecipient", args: [sellerWallet, true] });

  const token = randomBytes(24).toString("base64url");
  const invite = await db.sellerInvite.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      buyerWallet,
      sellerWallet,
      name: clean,
      currency,
      expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000),
    },
  });
  return { invite, token, payee };
}

/** A new link for an invite (the old one stops working), e.g. when the buyer lost it. */
export async function rotateInviteLink(userId: string, inviteId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const updated = await db.sellerInvite.updateMany({
    where: { id: inviteId, userId },
    data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000) },
  });
  if (updated.count !== 1) throw new InviteError("Invite not found");
  return token;
}

/**
 * The invite a request is about: by the link's secret, or "id.<inviteId>" for the signed-in seller
 * the invite was linked to (they reach it from their own Deals page, without the link).
 */
export async function inviteForRequest(token: string, sessionUserId: string | null): Promise<SellerInvite> {
  if (token.startsWith("id.")) {
    const invite = sessionUserId ? await db.sellerInvite.findFirst({ where: { id: token.slice(3), claimedByUserId: sessionUserId } }) : null;
    if (!invite) throw new InviteError("This deal is not linked to your account");
    return invite;
  }
  return inviteByToken(token);
}

/**
 * The invited seller already has an account and opened the link signed in: link the invite to it.
 * Their earnings go to their own wallet account (no payout form), the buyer becomes a contact, and
 * the deals show in their app. Not when the payout already goes somewhere else, or someone else
 * claimed it: whoever holds the link can claim it, as whoever holds it can already set the payout.
 */
export async function claimInvite(invite: SellerInvite, userId: string): Promise<SellerInvite> {
  if (invite.claimedByUserId === userId) return invite;
  if (invite.claimedByUserId) throw new InviteError("This invite is linked to another account");
  if (invite.userId === userId) throw new InviteError("This is your own invite: send the link to the seller");
  const account = await db.bankAccount.findFirst({
    where: { customer: { userId }, linkedAt: { not: null } },
    include: { customer: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (!account?.accountNo || !account.customer) throw new InviteError("Open your wallet first to link this deal to your account");
  if (account.currency !== invite.currency) throw new InviteError(`This deal pays ${invite.currency}; your wallet is in ${account.currency}`);
  if (invite.payoutSetAt && invite.payoutAccountId !== account.id) throw new InviteError("The payout of this invite already goes to another account");
  const updated = await db.sellerInvite.updateMany({
    where: { id: invite.id, claimedByUserId: null },
    data: {
      claimedByUserId: userId,
      claimedAt: new Date(),
      ...(invite.payoutSetAt
        ? {}
        : { payoutMethod: "MOCKBANK" as const, payoutTarget: account.accountNo, payoutAccountId: account.id, payoutName: maskName(account.customer.displayName), payoutSetAt: new Date() }),
    },
  });
  if (updated.count !== 1) throw new InviteError("This invite is linked to another account");
  // The buyer and the seller become contacts (both took a step: one invited, the other opened it).
  const [a, b] = [invite.userId, userId];
  const existing = await db.friendship.findFirst({ where: { OR: [{ requesterId: a, addresseeId: b }, { requesterId: b, addresseeId: a }] } });
  if (!existing) await db.friendship.create({ data: { requesterId: a, addresseeId: b, status: "ACCEPTED", acceptedAt: new Date() } });
  else if (existing.status !== "ACCEPTED") await db.friendship.update({ where: { id: existing.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
  const fresh = await db.sellerInvite.findUniqueOrThrow({ where: { id: invite.id } });
  await sweepInvite(getAddress(fresh.sellerWallet));
  return fresh;
}

/** Invites linked to this seller's account, for their Deals page. */
export function claimedInvites(userId: string) {
  return db.sellerInvite.findMany({ where: { claimedByUserId: userId }, orderBy: { claimedAt: "desc" } });
}

export async function inviteByToken(token: string): Promise<SellerInvite> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new InviteError("This link is not valid");
  const invite = await db.sellerInvite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite) throw new InviteError("This link is not valid or was replaced by a newer one");
  if (invite.expiresAt < new Date()) throw new InviteError("This link has expired; ask the buyer for a new one");
  return invite;
}

// ------------------------------------------------------------------------------------------
// Payout destination
// ------------------------------------------------------------------------------------------

/** Lower case, single spaces, without Thai and English titles: what a bank's name check compares. */
function normalName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(นาย|นางสาว|นาง|น\.ส\.|mr\.?|mrs\.?|ms\.?|miss)\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Somchai Jaidee" -> "Somchai J***", as a bank shows the payee before a transfer. */
function maskName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  return [first, ...rest.map((w) => `${w[0]}***`)].join(" ");
}

const digits = (s: string) => s.replace(/\D/g, "");

/** Mock Bank account numbers as the bank prints them (see customers.ts). */
function formatMockAccountNo(raw: string, currency: Currency): string | null {
  const d = digits(raw);
  if (currency === "THB") return d.length === 10 ? `${d.slice(0, 3)}-${d[3]}-${d.slice(4, 9)}-${d[9]}` : null;
  return d.length === 16 ? d.replace(/(\d{4})(?=\d)/g, "$1 ") : null;
}

/** Thai citizen id check digit. */
function validCitizenId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const sum = [...id.slice(0, 12)].reduce((t, c, i) => t + Number(c) * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

/** PromptPay ids: a Thai mobile number, a citizen / tax id, or a 15-digit e-wallet id. */
export function normalPromptPayId(raw: string): string | null {
  let d = digits(raw);
  if (d.startsWith("66") && d.length === 11) d = `0${d.slice(2)}`;
  if (/^0[689]\d{8}$/.test(d)) return d;
  if (validCitizenId(d)) return d;
  if (/^\d{15}$/.test(d)) return d;
  return null;
}

/** CRC-16/CCITT-FALSE, the checksum at the end of every Thai QR (EMVCo) payload. */
function crc16(s: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(s, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function tlv(payload: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isInteger(len) || i + 4 + len > payload.length) throw new InviteError("This QR code is not a Thai QR payment code");
    out.set(tag, payload.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

/**
 * Reads the PromptPay id from a Thai QR payment code (EMVCo merchant-presented, tag 29 with the
 * PromptPay AID). Bill-payment QR codes (tag 30) belong to a company's biller id, not a person.
 */
export function promptPayFromQr(payload: string): string {
  const p = payload.trim();
  if (p.length < 20 || p.slice(-8, -4) !== "6304") throw new InviteError("This QR code is not a Thai QR payment code");
  if (crc16(p.slice(0, -4)) !== p.slice(-4).toUpperCase()) throw new InviteError("The QR code's checksum does not match");
  const top = tlv(p);
  const pp = top.get("29");
  if (!pp) throw new InviteError("Only PromptPay QR codes can receive payouts here");
  const sub = tlv(pp);
  if (sub.get("00") !== "A000000677010111") throw new InviteError("Only PromptPay QR codes can receive payouts here");
  const raw = sub.get("01") ?? sub.get("02") ?? sub.get("03");
  if (!raw) throw new InviteError("The QR code has no PromptPay id");
  // Phone numbers are written as 0066 + number without the leading 0.
  const id = normalPromptPayId(raw.startsWith("0066") ? `0${raw.slice(4)}` : raw);
  if (!id) throw new InviteError("The QR code's PromptPay id is not valid");
  return id;
}

const THAI_BANKS = ["BBL", "KBANK", "KTB", "SCB", "BAY", "TTB", "GSB", "BAAC", "UOB", "CIMBT", "KKP", "LH", "TISCO", "GHB"] as const;
export const PAYOUT_BANKS = THAI_BANKS;

function externalAccount(currency: Currency) {
  const id = currency === "THB" ? "external-thb" : "external-cny";
  return db.bankAccount.upsert({
    where: { id },
    update: {},
    create: { id, kind: "EXTERNAL", label: `Outside the demo bank (${currency})`, currency },
  });
}

export type PayoutInput =
  | { method: "MOCKBANK"; accountNo: string; name: string }
  | { method: "PROMPTPAY"; promptPayId?: string; qr?: string; name: string }
  | { method: "BANK"; bank: string; accountNo: string; name: string };

/**
 * Sets where the seller's money goes. Once set it cannot be changed through the link. A Mock Bank
 * account must belong to someone with the given name; the response shows the masked name, as a
 * bank shows the payee before a transfer. Then sweeps whatever was already earned.
 */
export async function setPayout(invite: SellerInvite, input: PayoutInput): Promise<SellerInvite> {
  if (invite.payoutSetAt) throw new InviteError("The payout account is already set and locked");
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (name.length < 2) throw new InviteError("Enter the account holder's name");

  let data: { payoutMethod: PayoutMethod; payoutTarget: string; payoutBank?: string; payoutAccountId?: string; payoutName: string; opnRecipientId?: string };
  if (input.method === "MOCKBANK") {
    const accountNo = formatMockAccountNo(input.accountNo, invite.currency);
    if (!accountNo) throw new InviteError("Enter the full Mock Bank account number");
    const account = await db.bankAccount.findUnique({ where: { accountNo }, include: { customer: true } });
    if (!account?.customer) throw new InviteError("No Mock Bank account has this number");
    if (account.currency !== invite.currency) throw new InviteError(`This account holds ${account.currency}, the deal pays ${invite.currency}`);
    if (normalName(account.customer.displayName) !== normalName(name)) {
      throw new InviteError("The name does not match the account holder");
    }
    data = { payoutMethod: "MOCKBANK", payoutTarget: accountNo, payoutAccountId: account.id, payoutName: maskName(account.customer.displayName) };
  } else if (input.method === "PROMPTPAY") {
    const id = input.qr ? promptPayFromQr(input.qr) : normalPromptPayId(input.promptPayId ?? "");
    if (!id) throw new InviteError("Enter a mobile number, a 13-digit citizen id or an e-wallet id");
    if (invite.currency !== "THB") throw new InviteError("PromptPay pays baht only");
    data = { payoutMethod: "PROMPTPAY", payoutTarget: id, payoutName: maskName(name) };
  } else {
    if (!(THAI_BANKS as readonly string[]).includes(input.bank)) throw new InviteError("Choose a bank");
    const accountNo = digits(input.accountNo);
    if (accountNo.length < 10 || accountNo.length > 12) throw new InviteError("A Thai bank account number has 10 to 12 digits");
    // A real bank transfer through Opn Payments (test mode) when it is configured; simulated otherwise.
    const opnRecipientId = opnEnabled()
      ? await createRecipient({ name, bank: input.bank, accountNo }).catch((e) => {
          throw e instanceof OpnError ? new InviteError(e.message) : e;
        })
      : undefined;
    data = { payoutMethod: "BANK", payoutTarget: accountNo, payoutBank: input.bank, payoutName: maskName(name), ...(opnRecipientId ? { opnRecipientId } : {}) };
  }

  // Set once: the update only matches while no destination is set, so two requests cannot both win.
  const updated = await db.sellerInvite.updateMany({ where: { id: invite.id, payoutSetAt: null }, data: { ...data, payoutSetAt: new Date() } });
  if (updated.count !== 1) throw new InviteError("The payout account is already set and locked");
  const fresh = await db.sellerInvite.findUniqueOrThrow({ where: { id: invite.id } });
  await sweepInvite(getAddress(fresh.sellerWallet));
  return fresh;
}

/**
 * Moves what an invited seller has earned to their payout destination, one transfer per paid
 * milestone so it is paid exactly once. Does nothing for other wallets or before a destination is set.
 */
export async function sweepInvite(sellerWalletInput: Address): Promise<void> {
  const sellerWallet = getAddress(sellerWalletInput);
  const invite = await db.sellerInvite.findUnique({ where: { sellerWallet } });
  if (!invite?.payoutSetAt) return;
  const from = await accountOf(sellerWallet);
  if (!from) return;
  const to = invite.payoutAccountId ?? (await externalAccount(invite.currency)).id;
  const earned = await db.bankTransfer.findMany({ where: { toId: from.id, kind: "PAYOUT" } });
  for (const t of earned) {
    if (await db.bankTransfer.findUnique({ where: { idempotencyKey: `withdraw:${t.idempotencyKey}` } })) continue;
    // A bank payout through Opn: the money leaves the ledger only once Opn has sent it.
    if (invite.opnRecipientId && !(await sendThroughOpn(invite.id, invite.opnRecipientId, t.idempotencyKey, t.amount))) return;
    await transfer({ key: `withdraw:${t.idempotencyKey}`, kind: "WITHDRAW", fromId: from.id, toId: to, amount: t.amount });
  }
}

/**
 * One Opn transfer for one paid milestone. The row is claimed before calling Opn, so concurrent
 * sweeps cannot send twice; a crash after Opn accepted it is recovered by looking the transfer up
 * by its reference. Returns false while the recipient waits for the operator's activation or Opn
 * refuses (the next sweep retries).
 */
async function sendThroughOpn(inviteId: string, recipientId: string, payoutKey: string, amount: bigint): Promise<boolean> {
  const row =
    (await db.opnPayout.findUnique({ where: { payoutKey } })) ??
    (await db.opnPayout.create({ data: { payoutKey, inviteId, recipientId, amount } }).catch(() => db.opnPayout.findUniqueOrThrow({ where: { payoutKey } })));
  if (row.status === "PAID") return true;
  try {
    if (!(await recipient(recipientId)).active) {
      await db.opnPayout.update({ where: { id: row.id }, data: { error: "Waiting for the payment provider to approve this bank account" } });
      return false;
    }
    const claimed = await db.opnPayout.updateMany({ where: { id: row.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "SENDING" } });
    if (claimed.count !== 1) return false;
    const prior = await findTransfer(row.id);
    const t = prior?.paid ? prior : await sendTransfer(recipientId, amount, row.id);
    await db.opnPayout.update({ where: { id: row.id }, data: { status: "PAID", opnTransferId: t.id, error: null } });
    return true;
  } catch (err) {
    await db.opnPayout.update({ where: { id: row.id }, data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 300) : "Opn error" } });
    if (err instanceof OpnError) return false;
    throw err;
  }
}

// ------------------------------------------------------------------------------------------
// What the invited seller sees
// ------------------------------------------------------------------------------------------

export async function inviteView(invite: SellerInvite) {
  const sellerWallet = getAddress(invite.sellerWallet);
  const [buyer, deals, account] = await Promise.all([
    db.user.findUnique({ where: { id: invite.userId }, select: { name: true } }),
    readFileDeals(sellerWallet),
    accountOf(sellerWallet),
  ]);
  const [paidOut, withdrawn] = account
    ? await Promise.all([
        db.bankTransfer.aggregate({ where: { toId: account.id, kind: "PAYOUT" }, _sum: { amount: true } }),
        db.bankTransfer.aggregate({ where: { fromId: account.id, kind: "WITHDRAW" }, _sum: { amount: true } }),
      ])
    : [null, null];
  return {
    name: invite.name,
    buyerName: buyer?.name ?? "The buyer",
    currency: invite.currency,
    expiresAt: invite.expiresAt,
    sellerWallet,
    earned: (paidOut?._sum.amount ?? 0n).toString(),
    sent: (withdrawn?._sum.amount ?? 0n).toString(),
    payout: invite.payoutSetAt
      ? {
          method: invite.payoutMethod,
          // Only the last digits: the page is reachable by whoever has the link.
          target: `··${invite.payoutTarget!.replace(/\D/g, "").slice(-4)}`,
          bank: invite.payoutBank,
          name: invite.payoutName,
          setAt: invite.payoutSetAt,
        }
      : null,
    deals: deals.filter((d) => d.role === "seller"),
    // Bank payouts through Opn Payments: each transfer and its state.
    opn: invite.opnRecipientId
      ? {
          active: await recipient(invite.opnRecipientId).then((r) => r.active).catch(() => null),
          transfers: (await db.opnPayout.findMany({ where: { inviteId: invite.id }, orderBy: { createdAt: "desc" } })).map((p) => ({
            amount: p.amount.toString(),
            status: p.status,
            id: p.opnTransferId,
            error: p.error,
            at: p.updatedAt,
          })),
        }
      : null,
  };
}
