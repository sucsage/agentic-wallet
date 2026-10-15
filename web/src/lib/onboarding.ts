import "server-only";

import { randomBytes, randomInt } from "node:crypto";

import type { BankCustomer, KycApplication } from "@/generated/prisma/client";

import { db } from "./db";
import { hmac, maskThaiId, validChineseId, validThaiId } from "./kyc";

/**
 * Onboarding for the e-money wallet (like a mobile wallet app, not a bank login):
 *   1. sign up with email + password (Better Auth),
 *   2. verify identity (KYC): a national digital ID (mock ThaID / mock 国家网络身份认证) or an ID
 *      typed in for a reviewer,
 *   3. only an APPROVED application opens the wallet account: a THB or CNY e-money balance that
 *      starts at 0 and is topped up (card, PromptPay, counter service).
 *
 * The demo approves at once (KYC_AUTO_APPROVE, on unless set to "false"). In production a reviewer
 * decides at /admin/kyc, with sanctions screening and liveness checks in front of it.
 *
 * Internally the account is a ledger account (the "Mock Bank" tables), which keeps the funding
 * saga, the reserve and the mTHB / mCNY tokens exactly as they were.
 */

export class KycError extends Error {}

export const autoApprove = () => process.env.KYC_AUTO_APPROVE !== "false";

export type KycInput =
  | { method: "DOCUMENT"; country: "TH" | "CN"; legalName: string; idType: "NATIONAL_ID" | "PASSPORT"; idNumber: string; birthDate: string }
  | { method: "THAID"; legalName: string; pid: string; birthDate?: string }
  | { method: "CN_NETID"; legalName: string; wh: string };

/** E-money wallet numbers, e.g. 868-123-4567 (a mobile-wallet style id, not a bank account). */
export function walletNumber() {
  const d = `868${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Checks an application's identity and returns what is stored about it (never the raw id). */
function identity(input: KycInput) {
  if (input.method === "THAID") {
    return { country: "TH", idType: "NATIONAL_ID", maskedId: maskThaiId(input.pid), subjectHash: hmac("kyc:TH:NATIONAL_ID", input.pid) };
  }
  if (input.method === "CN_NETID") {
    return { country: "CN", idType: "NETWORK_ID", maskedId: `${input.wh.slice(0, 2)}••••${input.wh.slice(-4)}`, subjectHash: hmac("kyc:CN_NETID", input.wh) };
  }
  const id = input.idNumber.replace(/[\s-]/g, "").toUpperCase();
  if (input.idType === "NATIONAL_ID") {
    if (input.country === "TH" && !validThaiId(id)) throw new KycError("Not a valid Thai citizen id (13 digits; the last is a check digit)");
    if (input.country === "CN" && !validChineseId(id)) throw new KycError("Not a valid Chinese resident id (18 characters; the last is a check character)");
  } else if (!/^[A-Z0-9]{6,12}$/.test(id)) {
    throw new KycError("A passport number is 6-12 letters and digits");
  }
  const masked = input.idType === "NATIONAL_ID" && input.country === "TH" ? maskThaiId(id) : `${id.slice(0, 2)}${"•".repeat(Math.max(0, id.length - 4))}${id.slice(-2)}`;
  return { country: input.country, idType: input.idType, maskedId: masked, subjectHash: hmac(`kyc:${input.country}:${input.idType}`, id) };
}

/**
 * Records a KYC application. One identity can open one wallet. With auto-approval on, the wallet
 * account opens at once.
 */
export async function submitKyc(userId: string, input: KycInput): Promise<{ application: KycApplication; customer: BankCustomer | null }> {
  if (input.legalName.trim().length < 2) throw new KycError("Enter your name as on your ID");
  if (input.method === "DOCUMENT" && !/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) throw new KycError("Enter your date of birth");
  if (input.method === "DOCUMENT") {
    const age = (Date.now() - new Date(input.birthDate).getTime()) / (365.25 * 86_400_000);
    if (!(age >= 18 && age < 120)) throw new KycError("You must be 18 or older to open a wallet");
  }
  const id = identity(input);
  const prior = await db.kycApplication.findUnique({ where: { userId } });
  if (prior?.status === "APPROVED") return { application: prior, customer: await db.bankCustomer.findUnique({ where: { userId } }) };
  const taken = await db.kycApplication.findFirst({ where: { subjectHash: id.subjectHash, userId: { not: userId }, status: { not: "REJECTED" } } });
  if (taken) throw new KycError("This identity already has a wallet");
  const data = {
    country: id.country,
    method: input.method,
    legalName: input.legalName.trim(),
    idType: id.idType,
    maskedId: id.maskedId,
    subjectHash: id.subjectHash,
    birthDate: "birthDate" in input ? (input.birthDate ?? null) : null,
    status: "PENDING" as const,
    reviewer: null,
    reviewNote: null,
    decidedAt: null,
  };
  const application = await db.kycApplication.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  if (!autoApprove()) return { application, customer: null };
  return decideKyc(application.id, true, "auto", "Demo: approved automatically");
}

/** A reviewer's (or the demo's automatic) decision. Approval opens the wallet account. */
export async function decideKyc(applicationId: string, approve: boolean, reviewer: string, note?: string) {
  const app = await db.kycApplication.findUniqueOrThrow({ where: { id: applicationId } });
  const application = await db.kycApplication.update({
    where: { id: app.id },
    data: { status: approve ? "APPROVED" : "REJECTED", reviewer, reviewNote: note ?? null, decidedAt: new Date() },
  });
  if (!approve) return { application, customer: null };
  const customer = await openWalletAccount(app.userId, app.country === "CN" ? "CNY" : "THB", app.legalName);
  await db.kycVerification.upsert({
    where: { userId: app.userId },
    update: {},
    create: {
      userId: app.userId,
      provider: app.method === "CN_NETID" ? "CN_NETID" : "THAID",
      subjectHash: app.subjectHash,
      maskedId: app.maskedId,
      verifiedName: app.legalName,
    },
  }).catch(() => null);
  return { application, customer };
}

/** Opens the user's e-money account (balance 0). Safe to call again. */
export async function openWalletAccount(userId: string, currency: "THB" | "CNY", name: string): Promise<BankCustomer> {
  const existing = await db.bankCustomer.findUnique({ where: { userId } });
  if (existing) return existing;
  const customer = await db.bankCustomer.create({
    data: {
      currency,
      username: `w_${userId.slice(-12).toLowerCase()}`,
      displayName: name,
      type: "PERSONAL",
      // No PIN: wallet users sign in with email + password. A random hash keeps the column filled.
      pinHash: `unused:${randomBytes(16).toString("hex")}`,
      userId,
      consentedAt: new Date(),
    },
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    const ok = await db.bankAccount
      .create({
        data: { label: "Wallet balance", currency, accountNo: walletNumber(), customerId: customer.id, isDefault: true, linkedAt: new Date() },
      })
      .then(() => true)
      .catch(() => false);
    if (ok) break;
  }
  return customer;
}
