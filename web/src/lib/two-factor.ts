import "server-only";

import { createHmac, randomInt, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { db } from "./db";
import { emailEnabled, sendEmail } from "./email";

/**
 * Two-factor sign-in (demo). After the password / Google / Apple sign-in, a user who turned 2FA on
 * must pass one of their methods once per session before any wallet or money request works:
 *
 * - pin: a 6-digit PIN, stored as a salted scrypt hash, 5 tries per code window.
 * - email: a 6-digit code mailed to the account's address (10 minutes). Without a mailer
 *   (RESEND_API_KEY unset) the code is shown on screen, marked as a demo.
 * - sms: simulated; the code is shown on screen (no SMS provider in the demo).
 * - face / fingerprint / passkey: a WebAuthn credential made on this device (Touch ID, Face ID,
 *   Windows Hello or a security key). The demo checks that the browser produced one of the user's
 *   credential ids; it does not verify the signature server-side (a production build would use
 *   a WebAuthn library for that).
 *
 * Passing sets an httpOnly cookie bound to the session id with an HMAC, checked by the guard.
 */

export class TwoFactorError extends Error {}

export const METHODS = ["pin", "email", "sms", "face", "fingerprint", "passkey"] as const;
export type Method = (typeof METHODS)[number];

const COOKIE = "aw_2fa";
const SECRET = () => process.env.BETTER_AUTH_SECRET ?? process.env.MOCK_IDP_SECRET ?? "dev-2fa-secret";
const sign = (sessionId: string) => createHmac("sha256", SECRET()).update(`2fa:${sessionId}`).digest("base64url");

function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(secret, salt, 32).toString("hex")}`;
}

function checkSecret(secret: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const got = scryptSync(secret, Buffer.from(salt, "hex"), 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function securityOf(userId: string) {
  // A new user's first pages ask at the same time: two upserts can both try to create the row, and
  // the loser fails on the primary key. Read first, create once, and on that race read the winner's row.
  const found = await db.userSecurity.findUnique({ where: { userId } });
  if (found) return found;
  try {
    return await db.userSecurity.create({ data: { userId } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return db.userSecurity.findUniqueOrThrow({ where: { userId } });
    throw e;
  }
}

export function publicSecurity(s: Awaited<ReturnType<typeof securityOf>>) {
  return {
    enabled: s.enabled,
    methods: s.methods as Method[],
    hasPin: Boolean(s.pinHash),
    devices: s.credentialIds.length,
    phone: s.phone ? `•••${s.phone.slice(-3)}` : null,
  };
}

/** Whether this session passed 2FA (or the user has it off). */
export async function twoFactorPassed(userId: string, sessionId: string): Promise<boolean> {
  // The desktop app: its device key (linked after sign-in) is the second factor.
  if (sessionId.startsWith("device:")) return true;
  const s = await db.userSecurity.findUnique({ where: { userId } });
  if (!s?.enabled || s.methods.length === 0) return true;
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return false;
  const want = sign(sessionId);
  return v.length === want.length && timingSafeEqual(Buffer.from(v), Buffer.from(want));
}

async function pass(sessionId: string) {
  (await cookies()).set(COOKIE, sign(sessionId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7 });
}

// ------------------------------------------------------------------------------------------
// Setting up
// ------------------------------------------------------------------------------------------

export async function setPin(userId: string, pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new TwoFactorError("The PIN is 6 digits");
  if (/^(\d)\1{5}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) throw new TwoFactorError("Choose a PIN that is not all one digit or a run like 123456");
  await securityOf(userId);
  await db.userSecurity.update({ where: { userId }, data: { pinHash: hashSecret(pin) } });
}

export async function setPhone(userId: string, phone: string) {
  const clean = phone.replace(/[^\d+]/g, "");
  if (clean.replace(/\D/g, "").length < 9) throw new TwoFactorError("Enter a phone number");
  await securityOf(userId);
  await db.userSecurity.update({ where: { userId }, data: { phone: clean } });
}

export async function addCredential(userId: string, credentialId: string) {
  if (!/^[A-Za-z0-9_-]{16,1024}$/.test(credentialId)) throw new TwoFactorError("Not a device credential");
  const s = await securityOf(userId);
  if (s.credentialIds.includes(credentialId)) return;
  await db.userSecurity.update({ where: { userId }, data: { credentialIds: [...s.credentialIds, credentialId].slice(-5) } });
}

/** Turns methods on or off. 2FA is on while at least one usable method is on. */
export async function setMethods(userId: string, methods: Method[], sessionId: string) {
  const s = await securityOf(userId);
  for (const m of methods) {
    if (m === "pin" && !s.pinHash) throw new TwoFactorError("Set a PIN first");
    if ((m === "face" || m === "fingerprint" || m === "passkey") && s.credentialIds.length === 0) throw new TwoFactorError("Register this device first (Face / fingerprint / passkey)");
    if (m === "sms" && !s.phone) throw new TwoFactorError("Add a phone number first");
  }
  const unique = [...new Set(methods)];
  await db.userSecurity.update({ where: { userId }, data: { methods: unique, enabled: unique.length > 0 } });
  // Whoever just set it up is already through for this session.
  if (unique.length > 0) await pass(sessionId);
}

// ------------------------------------------------------------------------------------------
// Verifying
// ------------------------------------------------------------------------------------------

/** Starts an email or SMS code. Returns the code itself only when it cannot really be sent (demo). */
export async function startCode(userId: string, email: string, method: "email" | "sms"): Promise<{ sentTo: string; demoCode: string | null }> {
  const s = await securityOf(userId);
  if (!s.methods.includes(method)) throw new TwoFactorError("That method is not turned on");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.userSecurity.update({ where: { userId }, data: { otpHash: hashSecret(code), otpExpires: new Date(Date.now() + 10 * 60_000), otpTries: 0 } });
  if (method === "email" && emailEnabled) {
    await sendEmail({ to: email, subject: "Your Kravii sign-in code", text: `Your code is ${code}. It expires in 10 minutes. If you did not try to sign in, change your password.` });
    return { sentTo: email.replace(/^(.).*(@.*)$/, "$1•••$2"), demoCode: null };
  }
  return { sentTo: method === "sms" ? `•••${s.phone?.slice(-3) ?? ""} (simulated SMS)` : `${email.replace(/^(.).*(@.*)$/, "$1•••$2")} (no mailer: demo)`, demoCode: code };
}

export async function verify(userId: string, sessionId: string, method: Method, secret: string) {
  const s = await securityOf(userId);
  if (!s.methods.includes(method)) throw new TwoFactorError("That method is not turned on");
  if (s.otpTries >= 5 && (method === "pin" || method === "email" || method === "sms")) {
    // Five wrong tries lock code checks for 10 minutes (a new email / SMS code also resets it).
    if (Date.now() - s.updatedAt.getTime() < 10 * 60_000) throw new TwoFactorError("Too many wrong tries. Wait 10 minutes, or ask for a new code.");
    await db.userSecurity.update({ where: { userId }, data: { otpTries: 0 } });
  }
  let ok = false;
  if (method === "pin") ok = /^\d{6}$/.test(secret) && checkSecret(secret, s.pinHash);
  else if (method === "email" || method === "sms") ok = Boolean(s.otpExpires && s.otpExpires > new Date()) && /^\d{6}$/.test(secret) && checkSecret(secret, s.otpHash);
  else ok = s.credentialIds.includes(secret);
  if (!ok) {
    await db.userSecurity.update({ where: { userId }, data: { otpTries: { increment: 1 } } });
    throw new TwoFactorError(method === "pin" ? "Wrong PIN" : method === "email" || method === "sms" ? "Wrong or expired code" : "This device is not registered for your account");
  }
  await db.userSecurity.update({ where: { userId }, data: { otpTries: 0, otpHash: null, otpExpires: null } });
  await pass(sessionId);
}
