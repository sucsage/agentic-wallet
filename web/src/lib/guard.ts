import "server-only";

import { type Address, getAddress } from "viem";

import { agentWalletAbi } from "./abis";
import { getSession } from "./auth";
import { customerOfUser } from "./bank/customers";
import { primaryWalletAddress } from "./user-wallets";
import { publicClient, roleAddresses } from "./chain";
import { db } from "./db";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Only operate on sandbox wallets owned by this demo's owner key. */
export async function demoWallet(raw: string): Promise<Address> {
  let wallet: Address;
  try {
    wallet = getAddress(raw);
  } catch {
    throw new HttpError(400, "Invalid wallet address");
  }
  try {
    const owner = await publicClient().readContract({ address: wallet, abi: agentWalletAbi, functionName: "owner" });
    if (owner.toLowerCase() !== roleAddresses().owner.toLowerCase()) throw new Error("not ours");
  } catch {
    throw new HttpError(404, "Not an Agentic Wallet sandbox on this network");
  }
  return wallet;
}

/** The signed-in user. Every wallet operation requires an account. */
export async function requireUser() {
  const session = await getSession();
  if (!session) throw new HttpError(401, "Sign in first");
  return session.user;
}

/** The signed-in user and the Mock Bank customer they signed in as. */
export async function requireCustomer() {
  const session = await getSession();
  if (!session) throw new HttpError(401, "Sign in first");
  const user = session.user;
  // 2FA turned on: nothing about money or contacts works until this session passed it.
  const { twoFactorPassed } = await import("./two-factor");
  if (!(await twoFactorPassed(user.id, session.session.id))) throw new HttpError(428, "Verify it's you with your second factor first");
  const customer = await customerOfUser(user.id);
  if (!customer) throw new HttpError(403, "Sign in through the Mock Bank first");
  return { user, customer };
}

/** A reviewer: a bank customer flagged isAdmin (only scripts/make-admin.mts sets it). */
export async function requireAdmin() {
  const { user, customer } = await requireCustomer();
  if (!customer.isAdmin) throw new HttpError(403, "Admins only");
  return { user, customer };
}

/**
 * The company the user chose to act as ("Acting as"), from the aw_acting cookie, if they still
 * belong to it. Everything about a wallet (deals, approvals, policy, summary) follows it; the
 * user's own things (identity, contacts, groups, top-ups) do not.
 */
export async function actingAs(userId: string) {
  const { cookies } = await import("next/headers");
  const { ACTING_COOKIE, actingCompany } = await import("./company");
  const id = (await cookies()).get(ACTING_COOKIE)?.value;
  return actingCompany(userId, id);
}

/** The customer whose money the user is looking at: the company they act as, else their own. */
export async function requireActingCustomer() {
  const { user, customer } = await requireCustomer();
  const company = await actingAs(user.id);
  if (!company) return { user, customer, company: null };
  return { user, customer: await db.bankCustomer.findUniqueOrThrow({ where: { id: company.customerId } }), company };
}

/** The signed-in customer's agent wallet (the one their bank account pays for). */
export async function requireBankWallet() {
  const { user, customer, company } = await requireActingCustomer();
  if (company) return { user, customer, wallet: await demoWallet(company.walletAddress), company };
  const primary = await primaryWalletAddress(user.id);
  if (!primary) throw new HttpError(409, "Create your agent wallet first");
  return { user, customer, wallet: await demoWallet(primary), company: null };
}

/**
 * Money and payee changes on a company belong to its signers. Throws 403 for a plain member acting
 * as the company; a personal wallet (company null) always passes. Use after requireBankWallet or
 * requireActingCustomer on every route that moves money, changes who can be paid, changes the
 * caps or re-links the company's bank account (DC-CO-01).
 */
export async function assertCompanySigner(userId: string, company: { groupId: string } | null) {
  if (!company) return;
  const { isCompanySigner } = await import("./company");
  if (!(await isCompanySigner(userId, company.groupId))) throw new HttpError(403, "Only a company signer can do this");
}

/** requireBankWallet, plus: acting as a company means being one of its signers. */
export async function requireBankSigner() {
  const r = await requireBankWallet();
  await assertCompanySigner(r.user.id, r.company);
  return r;
}

/** requireActingCustomer, plus: acting as a company means being one of its signers. */
export async function requireActingSigner() {
  const r = await requireActingCustomer();
  await assertCompanySigner(r.user.id, r.company);
  return r;
}

/** A sandbox wallet that belongs to the signed-in user (UserWallet row) and to this demo on-chain. */
export async function userWallet(raw: string): Promise<Address> {
  const { user } = await requireCustomer();
  let wallet: Address;
  try {
    wallet = getAddress(raw);
  } catch {
    throw new HttpError(400, "Invalid wallet address");
  }
  const link = await db.userWallet.findUnique({
    where: { userId_walletAddress: { userId: user.id, walletAddress: wallet } },
  });
  // 404, not 403: don't confirm that someone else's wallet exists.
  if (!link) throw new HttpError(404, "Wallet not found in your account");
  return demoWallet(wallet);
}

// Best-effort, per-instance rate limit so a public demo can't burn the API budget or gas.
const hits = new Map<string, number[]>();
export function rateLimit(req: Request, bucket: string, max: number, windowMs: number) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) throw new HttpError(429, "Too many requests, please slow down.");
  recent.push(now);
  hits.set(key, recent);
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  console.error(err);
  return Response.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
}
