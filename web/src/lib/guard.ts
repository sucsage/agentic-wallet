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
  const user = await requireUser();
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

/** The signed-in customer's agent wallet (the one their bank account pays for). */
export async function requireBankWallet() {
  const { user, customer } = await requireCustomer();
  const primary = await primaryWalletAddress(user.id);
  if (!primary) throw new HttpError(409, "Create your agent wallet first");
  return { user, customer, wallet: await demoWallet(primary) };
}

/** A sandbox wallet that belongs to the signed-in user (UserWallet row) and to this demo on-chain. */
export async function userWallet(raw: string): Promise<Address> {
  const user = await requireUser();
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
