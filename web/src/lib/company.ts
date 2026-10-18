import "server-only";

import { randomBytes } from "node:crypto";

import { type Address, getAddress } from "viem";

import type { Company, Currency } from "@/generated/prisma/client";

import { createWorkspace } from "./actions";
import { backWallet } from "./bank/customers";
import { config } from "./config";
import { transfer } from "./bank/ledger";
import { db } from "./db";
import { hmac, kycOf } from "./kyc";
import { walletNumber } from "./onboarding";
import { type GroupInviteInput, SocialError, createGroup } from "./social";
import { linkNewWallet } from "./user-wallets";

/**
 * Company accounts (Napat's v0.8 "Acting as · Company"). A company has its own e-money account
 * and agent wallet, run by a group of signers: its members draft deals as the company, and a
 * deal locks only after N of M signers approve (the group vote). Members fund it by moving money
 * from their own wallet; a company never tops up by card here.
 *
 * Registration ids are checked by their check digit (Thai juristic id: 13 digits, mod 11;
 * Chinese unified social credit code: 18 characters, GB 32100-2015) and stored masked + HMAC,
 * like a person's id. The registry lookup itself is mocked: a real one would query DBD / SAMR.
 */

export class CompanyError extends Error {}

export const ACTING_COOKIE = "aw_acting";

/** Thai juristic person id (13 digits, starts with 0): the same mod-11 check as a citizen id. */
export function validThaiJuristicId(id: string): boolean {
  if (!/^0\d{12}$/.test(id)) return false;
  const sum = [...id.slice(0, 12)].reduce((t, d, i) => t + Number(d) * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

const USCC = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const USCC_W = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
/** Chinese unified social credit code (18 characters, GB 32100-2015 check character). */
export function validUscc(id: string): boolean {
  if (!/^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$/.test(id)) return false;
  const sum = [...id.slice(0, 17)].reduce((t, c, i) => t + USCC.indexOf(c) * USCC_W[i], 0);
  return USCC[(31 - (sum % 31)) % 31] === id[17];
}

const mask = (id: string) => `${id.slice(0, 4)}${"•".repeat(Math.max(0, id.length - 8))}${id.slice(-4)}`;

/**
 * Registers a company: checks the id, opens its account and agent wallet, and invites its other
 * signers / members (they join by accepting, then reach the company wallet).
 */
export async function createCompany(
  userId: string,
  input: { name: string; taxId: string; members: GroupInviteInput[]; threshold: number },
): Promise<Company> {
  const me = await db.bankCustomer.findUnique({ where: { userId } });
  if (!me) throw new CompanyError("Open your own wallet first");
  if (!(await kycOf(userId))) throw new CompanyError("Verify your identity first: a company's admin must be a verified person");
  const name = input.name.trim().slice(0, 80);
  if (name.length < 2) throw new CompanyError("Enter the company's registered name");
  const taxId = input.taxId.replace(/[\s-]/g, "").toUpperCase();
  const currency: Currency = me.currency;
  if (currency === "THB" ? !validThaiJuristicId(taxId) : !validUscc(taxId)) {
    throw new CompanyError(
      currency === "THB"
        ? "Not a valid Thai juristic person id (13 digits starting with 0; the last is a check digit)"
        : "Not a valid unified social credit code (18 characters; the last is a check character)",
    );
  }
  const taxIdHash = hmac(`kyb:${currency}`, taxId);
  if (await db.company.findUnique({ where: { taxIdHash } })) throw new CompanyError("This company already has an account");

  // Validate the signers before anything is deployed.
  const group = await createGroup(userId, currency, { name, members: input.members, threshold: input.threshold });
  try {
    return await openSharedWallet(userId, group.id, { kind: "COMPANY", name, currency, maskedTaxId: mask(taxId), taxIdHash });
  } catch (err) {
    await db.group.delete({ where: { id: group.id } }).catch(() => null);
    throw err instanceof SocialError ? new CompanyError(err.message) : err;
  }
}

/**
 * A group of friends opens its own shared wallet (no registration): from then on its members can
 * hire and sell in the group's name (Acting as), its money moves only after N of M signers approve,
 * and what it earns lands in the group account. Only the group's owner opens it.
 */
export async function createGroupWallet(userId: string, groupId: string): Promise<Company> {
  const group = await db.group.findFirst({ where: { id: groupId, members: { some: { userId, role: "ADMIN" } } }, include: { company: true } });
  if (!group) throw new CompanyError("Only the group's owner can open its wallet");
  if (group.company) throw new CompanyError("This group already has a wallet");
  if (!(await kycOf(userId))) throw new CompanyError("Verify your identity first: the owner of a shared wallet must be a verified person");
  return openSharedWallet(userId, group.id, { kind: "GROUP", name: group.name, currency: group.currency });
}

/** The shared account and agent wallet of a company or group; every member reaches it. */
async function openSharedWallet(
  userId: string,
  groupId: string,
  o: { kind: "COMPANY" | "GROUP"; name: string; currency: Currency; maskedTaxId?: string; taxIdHash?: string },
): Promise<Company> {
  const { address, outcome } = await createWorkspace({ currency: o.currency });
  const customer = await db.bankCustomer.create({
    data: {
      currency: o.currency,
      username: `${o.kind === "GROUP" ? "g" : "c"}_${randomBytes(6).toString("hex")}`,
      displayName: o.name,
      type: "COMPANY",
      pinHash: `unused:${randomBytes(16).toString("hex")}`,
      consentedAt: new Date(),
    },
  });
  let account = null;
  for (let attempt = 0; attempt < 5 && !account; attempt++) {
    account = await db.bankAccount
      .create({ data: { label: o.kind === "GROUP" ? "Group account" : "Company account", currency: o.currency, accountNo: walletNumber(), customerId: customer.id, isDefault: true, linkedAt: new Date() } })
      .catch(() => null);
  }
  if (!account) throw new CompanyError(`Could not open the ${o.kind === "GROUP" ? "group" : "company"} account`);
  if ("hash" in outcome) await linkNewWallet(userId, address, outcome.hash, config.bankToken(o.currency) ?? config.contracts.usdc);
  await db.userWallet.update({ where: { userId_walletAddress: { userId, walletAddress: address } }, data: { label: o.name, role: "OWNER" } });
  // Members already in the group reach the wallet too (signers approve, others view).
  const members = await db.groupMember.findMany({ where: { groupId, userId: { not: userId } } });
  for (const m of members) {
    await db.userWallet.upsert({
      where: { userId_walletAddress: { userId: m.userId, walletAddress: address } },
      update: {},
      create: { userId: m.userId, walletAddress: address, role: m.canSign ? "APPROVER" : "VIEWER", label: o.name },
    });
  }
  await backWallet(account.id, address);
  return db.company.create({
    data: {
      kind: o.kind,
      name: o.name,
      maskedTaxId: o.maskedTaxId ?? null,
      taxIdHash: o.taxIdHash ?? null,
      currency: o.currency,
      customerId: customer.id,
      walletAddress: address,
      groupId,
      createdById: userId,
    },
  });
}

/** Companies the user belongs to (as a member of their signers group). */
export async function companiesOf(userId: string) {
  const rows = await db.company.findMany({
    where: { group: { members: { some: { userId } } } },
    include: { group: { include: { members: true } } },
    orderBy: { createdAt: "asc" },
  });
  const accounts = await db.bankAccount.findMany({ where: { ownerAddress: { in: rows.map((c) => c.walletAddress.toLowerCase()) } } });
  return rows.map((c) => {
    const me = c.group.members.find((m) => m.userId === userId);
    const a = accounts.find((x) => x.ownerAddress === c.walletAddress.toLowerCase());
    return {
      id: c.id,
      kind: c.kind,
      name: c.name,
      maskedTaxId: c.maskedTaxId,
      currency: c.currency,
      wallet: c.walletAddress,
      groupId: c.groupId,
      threshold: c.group.threshold,
      signers: c.group.members.filter((m) => m.canSign).length,
      members: c.group.members.length,
      role: me?.role === "ADMIN" ? "Admin" : me?.canSign ? "Signer" : "Member",
      accountNo: a?.accountNo ?? null,
      balance: a?.balance.toString() ?? "0",
    };
  });
}

/** The company the user acts as, if they chose one and still belong to it. */
export async function actingCompany(userId: string, companyId: string | undefined | null) {
  if (!companyId) return null;
  return db.company.findFirst({ where: { id: companyId, group: { members: { some: { userId } } } }, include: { group: true } });
}

/**
 * Whether the user may move money or re-route payments for this company: a signer (canSign).
 * Plain members may look and propose, nothing more. Being a member is not enough (DC-CO-01).
 */
export async function isCompanySigner(userId: string, groupId: string): Promise<boolean> {
  const m = await db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } }, select: { canSign: true } });
  return m?.canSign === true;
}

/** Whether `userId` may spend from or re-route this wallet: any user for a personal wallet, a signer for a company's. */
export async function canSpendFrom(userId: string, wallet: Address): Promise<boolean> {
  const company = await companyOfWallet(wallet);
  return !company || isCompanySigner(userId, company.groupId);
}

/** The company whose wallet this is, if any. */
export function companyOfWallet(wallet: Address) {
  return db.company.findUnique({ where: { walletAddress: getAddress(wallet) }, include: { group: true } });
}

/** A member moves money from their own wallet into the company account (once per request id). */
export async function fundCompany(userId: string, companyId: string, amount: number, requestId: string) {
  const company = await actingCompany(userId, companyId);
  if (!company) throw new CompanyError("Company not found");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new CompanyError("Enter an amount");
  const from = await db.bankAccount.findFirst({ where: { customer: { userId }, linkedAt: { not: null } }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  const to = await db.bankAccount.findUnique({ where: { ownerAddress: company.walletAddress.toLowerCase() } });
  if (!from || !to) throw new CompanyError("Account not found");
  if (from.currency !== to.currency) throw new CompanyError(`The company account is in ${to.currency}`);
  const minor = BigInt(Math.round(amount * 100));
  if (from.balance < minor) throw new CompanyError("Not enough money in your wallet");
  return transfer({ key: `company-fund:${company.id}:${userId}:${requestId}`, kind: "TRANSFER", fromId: from.id, toId: to.id, amount: minor });
}
