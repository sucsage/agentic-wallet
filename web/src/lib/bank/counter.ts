import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { transfer } from "./ledger";
import { TopupError, checkTopup } from "./topup";

/**
 * MOCK counter-service top-up (like paying a wallet top-up at a convenience store): the app issues
 * a payment slip with a reference and barcode; the "cashier" step is simulated in the demo. The
 * slip is a signed token (amount, account, expiry), and the reference is the idempotency key, so a
 * slip pays in once. Nothing real is collected; the UI labels it as a demo.
 */

const key = () => {
  const s = process.env.MOCK_IDP_SECRET;
  if (!s) throw new TopupError("Counter top-up is not configured");
  return new Uint8Array(createHmac("sha256", s).update("counter-slip").digest());
};

export async function issueSlip(userId: string, amount: number) {
  const { account, currency, minor } = await checkTopup(userId, amount);
  const ref = `CS${Date.now().toString().slice(-6)}${randomBytes(3).toString("hex").toUpperCase()}`;
  const slip = await new SignJWT({ ref, accountId: account.id, minor: String(minor), uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(key());
  return { ref, slip, amount: minor / 100, currency, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
}

/** The simulated cashier scans the slip: the account is credited once per reference. */
export async function paySlip(userId: string, slip: string) {
  const { payload } = await jwtVerify(slip, key()).catch(() => {
    throw new TopupError("This slip is invalid or expired");
  });
  if (payload.uid !== userId) throw new TopupError("This slip belongs to another user");
  const amount = BigInt(String(payload.minor));
  await transfer({ key: `counter:${payload.ref}`, kind: "TOPUP", fromId: null, toId: String(payload.accountId), amount });
  return { ref: String(payload.ref), amount: Number(amount) / 100 };
}
