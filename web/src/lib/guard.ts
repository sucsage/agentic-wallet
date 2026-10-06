import "server-only";

import { type Address, getAddress } from "viem";

import { agentWalletAbi } from "./abis";
import { publicClient, roleAddresses } from "./chain";

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
