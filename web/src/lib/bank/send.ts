import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { db } from "../db";
import { KycRequired, requireKycFor } from "../kyc";
import { SEND_LIMITS } from "../send-limits";

/**
 * Sending money to several people at once: from your own wallet account to friends, or from a
 * company's / group's shared account to its members (after the signers' vote, see social.ts).
 * All the transfers happen in one database transaction, so either everyone is paid or nobody is,
 * and the same request id never pays twice.
 */

export class SendError extends Error {}

export type Recipient = { userId: string; amount: number };

const MAX_RECIPIENTS = 20;

/** A user's own wallet account (the one deals are paid from). */
export function walletAccountOf(userId: string) {
  return db.bankAccount.findFirst({ where: { customer: { userId }, linkedAt: { not: null } }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
}

/** Checks the list and turns amounts (major units) into satang / fen. */
export function cleanRecipients(list: Recipient[], limits?: { min: number; max: number }): { userId: string; minor: bigint }[] {
  if (list.length === 0) throw new SendError("Choose at least one person");
  if (list.length > MAX_RECIPIENTS) throw new SendError(`At most ${MAX_RECIPIENTS} people at once`);
  if (new Set(list.map((r) => r.userId)).size !== list.length) throw new SendError("Each person once only");
  return list.map((r) => {
    if (!Number.isFinite(r.amount) || r.amount <= 0 || r.amount > 1_000_000) throw new SendError("Every amount must be above 0");
    if (limits && (r.amount < limits.min || r.amount > limits.max)) {
      throw new SendError(`Each person gets ${limits.min.toLocaleString("en-US")} to ${limits.max.toLocaleString("en-US")} per transfer`);
    }
    return { userId: r.userId, minor: BigInt(Math.round(r.amount * 100)) };
  });
}

/** Pays everyone from one account, all or nothing, once per key. Returns how much went out. */
export async function payMany(fromId: string, recipients: { userId: string; minor: bigint }[], key: string) {
  const from = await db.bankAccount.findUniqueOrThrow({ where: { id: fromId } });
  const targets = await Promise.all(recipients.map(async (r) => ({ ...r, account: await walletAccountOf(r.userId) })));
  for (const t of targets) {
    if (!t.account) throw new SendError("Someone on the list has no wallet yet");
    if (t.account.id === fromId) throw new SendError("You cannot send to the same account");
    if (t.account.currency !== from.currency) throw new SendError(`Someone on the list has a ${t.account.currency} wallet; this one is ${from.currency}`);
  }
  const total = recipients.reduce((t, r) => t + r.minor, 0n);
  // Sent before with this key: report it instead of paying again.
  if (await db.bankTransfer.findUnique({ where: { idempotencyKey: `${key}:${recipients[0].userId}` } })) return { total, already: true };
  try {
    await db.$transaction(async (tx) => {
      const debited = await tx.bankAccount.updateMany({ where: { id: fromId, balance: { gte: total } }, data: { balance: { decrement: total } } });
      if (debited.count !== 1) throw new SendError("Not enough money in the account for everyone");
      for (const t of targets) {
        await tx.bankTransfer.create({ data: { idempotencyKey: `${key}:${t.userId}`, kind: "TRANSFER", fromId, toId: t.account!.id, amount: t.minor } });
        await tx.bankAccount.update({ where: { id: t.account!.id }, data: { balance: { increment: t.minor } } });
      }
    });
  } catch (err) {
    // Two clicks at once: the other one paid.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { total, already: true };
    throw err;
  }
  return { total, already: false };
}

/** From your own wallet to friends (accepted contacts only). */
export async function sendToFriends(userId: string, list: Recipient[], requestId: string) {
  const recipients = cleanRecipients(list, SEND_LIMITS);
  const friends = await db.friendship.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  const ok = new Set(friends.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId)));
  if (recipients.some((r) => !ok.has(r.userId))) throw new SendError("You can send only to your contacts");
  const from = await walletAccountOf(userId);
  if (!from) throw new SendError("Open your wallet first");
  const total = recipients.reduce((t, r) => t + Number(r.minor), 0) / 100;
  await requireKycFor(userId, from.currency, total).catch((e) => {
    throw e instanceof KycRequired ? new SendError(e.message.replace("Deals above", "Payments above")) : e;
  });
  return payMany(from.id, recipients, `send:${userId}:${requestId}`);
}
