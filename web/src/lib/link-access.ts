import "server-only";

import { randomInt, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import type { BuyerInvite, SellerInvite } from "@/generated/prisma/client";

import { db } from "./db";
import { hmac } from "./kyc";
import { openToken, sealToken } from "./link-seal";

/**
 * Who may open a private link (a seller hired, or a buyer sold to, without an account). Holding the
 * link is not enough: on Confirm the app makes a one-time code (OTP) that the inviter sends to the
 * person separately; they enter it once on the link and set their own password, and from then on the
 * link asks for that password. If they lose it, the link gives them a reset code to send to the
 * inviter, who enters it on the deal's page: the password is cleared and a new OTP is made.
 * So a forwarded or leaked link alone opens nothing, and the inviter cannot take over the page after
 * the person set a password (the reset needs the code only the person sees).
 */

export type LinkKind = "seller" | "buyer";
type Invite = SellerInvite | BuyerInvite;

export class LinkAccessError extends Error {
  constructor(
    message: string,
    readonly state: "otp" | "password" | "locked" | "bad",
  ) {
    super(message);
    this.name = "LinkAccessError";
  }
}

const OTP_DAYS = 14;
const RESET_HOURS = 24;
const MAX_TRIES = 5;
const LOCK_MINUTES = 15;
const COOKIE_DAYS = 30;

const table = (kind: LinkKind) => (kind === "seller" ? db.sellerInvite : db.buyerInvite) as unknown as {
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Invite>;
};
const codeHash = (inviteId: string, purpose: string, code: string) => hmac(`link-${purpose}:${inviteId}`, code);
const cookieName = (kind: LinkKind, id: string) => `aw_link_${kind}_${id}`;
const cookieValue = (kind: LinkKind, inv: Invite) => hmac("link-access", `${kind}:${inv.id}:${inv.accessVersion}`);

function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
function passwordOk(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = scryptSync(pw, Buffer.from(salt, "hex"), 32);
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
const sixDigits = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** A fresh one-time code for the link (shown to the inviter to send); the old one stops working. */
export async function issueOtp(kind: LinkKind, invite: Invite): Promise<{ otp: string; expiresAt: Date }> {
  const otp = sixDigits();
  const expiresAt = new Date(Date.now() + OTP_DAYS * 86_400_000);
  await table(kind).update({
    where: { id: invite.id },
    data: { accessRequired: true, accessOtpEnc: sealToken(otp), accessOtpHash: codeHash(invite.id, "otp", otp), accessOtpExpires: expiresAt, accessTries: 0, accessLockedTill: null },
  });
  return { otp, expiresAt };
}

/** What the inviter sees on the deal's page about the person's access. */
export function accessForInviter(invite: Invite) {
  if (!invite.accessRequired) return { required: false as const };
  const otpLive = Boolean(invite.accessOtpHash && invite.accessOtpExpires && invite.accessOtpExpires > new Date());
  return {
    required: true as const,
    passwordSet: Boolean(invite.accessPassword),
    otp: otpLive ? openToken(invite.accessOtpEnc) : null,
    otpExpiresAt: otpLive ? invite.accessOtpExpires : null,
  };
}

/** What the link's page needs to ask: nothing (open), the OTP (then a password), or the password. */
export function accessState(invite: Invite): "open" | "otp" | "password" {
  if (!invite.accessRequired) return "open";
  return invite.accessPassword ? "password" : "otp";
}

/** Throws unless this browser may open the link (or the link has no access control, or its owner is signed in). */
export async function requireLinkAccess(kind: LinkKind, invite: Invite, sessionUserId: string | null = null): Promise<void> {
  if (!invite.accessRequired) return;
  if (kind === "seller" && sessionUserId && (invite as SellerInvite).claimedByUserId === sessionUserId) return;
  const got = (await cookies()).get(cookieName(kind, invite.id))?.value;
  if (got && got === cookieValue(kind, invite)) return;
  const state = accessState(invite);
  throw new LinkAccessError(state === "otp" ? "Enter the one-time code you were sent with this link" : "Enter this link's password", state === "open" ? "bad" : state);
}

async function grant(kind: LinkKind, invite: Invite) {
  (await cookies()).set(cookieName(kind, invite.id), cookieValue(kind, invite), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_DAYS * 86_400,
  });
}

async function countFailure(kind: LinkKind, invite: Invite, message: string): Promise<never> {
  const tries = invite.accessTries + 1;
  const lock = tries >= MAX_TRIES;
  await table(kind).update({ where: { id: invite.id }, data: lock ? { accessTries: 0, accessLockedTill: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { accessTries: tries } });
  throw new LinkAccessError(lock ? `Too many wrong tries: wait ${LOCK_MINUTES} minutes` : message, lock ? "locked" : "bad");
}

function checkLock(invite: Invite) {
  if (invite.accessLockedTill && invite.accessLockedTill > new Date()) throw new LinkAccessError(`Too many wrong tries: wait until ${invite.accessLockedTill.toLocaleTimeString("en-GB")}`, "locked");
}

function checkPasswordRules(pw: string) {
  if (pw.length < 8 || pw.length > 100) throw new LinkAccessError("The password needs 8 to 100 characters", "bad");
  if (!/[A-Za-z฀-๿]/.test(pw) || !/\d/.test(pw)) throw new LinkAccessError("Use letters and at least one number", "bad");
}

/** First visit: the OTP the inviter sent, and the person's own password. */
export async function setupWithOtp(kind: LinkKind, invite: Invite, otp: string, password: string): Promise<void> {
  checkLock(invite);
  if (!invite.accessRequired) throw new LinkAccessError("This link has no code to enter", "bad");
  if (invite.accessPassword) throw new LinkAccessError("A password is already set: sign in with it", "password");
  if (!invite.accessOtpHash || !invite.accessOtpExpires || invite.accessOtpExpires < new Date()) {
    throw new LinkAccessError("This code expired: ask the person who sent the link for a new one", "otp");
  }
  if (codeHash(invite.id, "otp", otp.replace(/\D/g, "")) !== invite.accessOtpHash) return countFailure(kind, invite, "Wrong code");
  checkPasswordRules(password);
  const updated = await table(kind).update({
    where: { id: invite.id },
    data: { accessPassword: hashPassword(password), accessOtpHash: null, accessOtpEnc: null, accessOtpExpires: null, accessTries: 0, accessLockedTill: null, accessResetHash: null, accessResetUntil: null },
  });
  await grant(kind, updated);
}

export async function signInWithPassword(kind: LinkKind, invite: Invite, password: string): Promise<void> {
  checkLock(invite);
  if (!invite.accessPassword) throw new LinkAccessError("No password yet: enter the one-time code first", "otp");
  if (!passwordOk(password, invite.accessPassword)) return countFailure(kind, invite, "Wrong password");
  await table(kind).update({ where: { id: invite.id }, data: { accessTries: 0 } });
  await grant(kind, invite);
}

/** Lost the password (or the code): a reset code for the person to send to the inviter. */
export async function startReset(kind: LinkKind, invite: Invite): Promise<{ code: string; until: Date }> {
  if (!invite.accessRequired) throw new LinkAccessError("This link has no password", "bad");
  const code = sixDigits();
  const until = new Date(Date.now() + RESET_HOURS * 3_600_000);
  await table(kind).update({ where: { id: invite.id }, data: { accessResetHash: codeHash(invite.id, "reset", code), accessResetUntil: until } });
  return { code, until };
}

/**
 * The inviter enters the reset code the person sent them: the password is cleared, everyone signed
 * in on the link is signed out, and a new OTP is made for the inviter to send.
 */
export async function resetWithCode(kind: LinkKind, invite: Invite, code: string): Promise<{ otp: string; expiresAt: Date }> {
  await consumeResetCode(kind, invite, code);
  return issueOtp(kind, invite);
}

/**
 * The code the link's holder got from "Forgot password" (or "I need a new link") on their page,
 * entered by the inviter. Used once: the password is cleared and everyone signed in on the link is
 * signed out. Nothing about the link can change without it, so the inviter cannot take the link
 * over (or hand it to someone else) on their own.
 */
export async function consumeResetCode(kind: LinkKind, invite: Invite, code: string): Promise<void> {
  checkLock(invite);
  if (!invite.accessResetHash || !invite.accessResetUntil || invite.accessResetUntil < new Date()) {
    throw new LinkAccessError("No code was asked for, or it expired: the person presses “Forgot password” (or “Lost the code?”) on their link and sends you the code", "bad");
  }
  if (codeHash(invite.id, "reset", code.replace(/\D/g, "")) !== invite.accessResetHash) {
    await countFailure(kind, invite, "Wrong code");
    return;
  }
  await table(kind).update({
    where: { id: invite.id },
    data: { accessPassword: null, accessVersion: { increment: 1 }, accessResetHash: null, accessResetUntil: null, accessTries: 0 },
  });
}
