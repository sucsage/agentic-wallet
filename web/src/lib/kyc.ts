import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import type { KycProvider } from "@/generated/prisma/client";

import { db } from "./db";

/**
 * KYC through a national digital ID, the way a bank app would do it: OpenID Connect,
 * authorization code flow with PKCE, state and nonce.
 *
 *   Thai users    → mock ThaID (DOPA's digital ID app). The id_token carries the citizen id (pid)
 *                   and names, as ThaID releases them to a relying party with the user's consent.
 *   Chinese users → mock 国家网络身份认证 (National Network Identity). Its design is privacy-first:
 *                   the relying party gets a 网号 (an opaque network id) and a name-match result,
 *                   never the resident id number.
 *
 * Both providers live in this app (src/app/mock-id/*, src/app/api/mock-id/*) and are labelled as
 * demos; the relying-party side (start → callback → token exchange → id_token checks) is written
 * as it would be against the real ones. We never store an id number: only an HMAC of it (so one
 * person cannot verify many accounts) and a masked form for the user to recognise.
 */

export const CLIENT_ID = "agentic-wallet";
export const MOCK_ISSUER = { THAID: "https://mock-thaid.agentic-wallet.demo", CN_NETID: "https://mock-netid.agentic-wallet.demo" } as const;

function secret(): string {
  const s = process.env.MOCK_IDP_SECRET;
  if (!s) throw new Error("MOCK_IDP_SECRET is not set");
  return s;
}

const key = (purpose: string) => new Uint8Array(createHmac("sha256", secret()).update(purpose).digest());
/** The client secret the app presents at the token endpoint. */
export const clientSecret = () => createHmac("sha256", secret()).update("client-secret").digest("base64url");
export const hmac = (purpose: string, value: string) => createHmac("sha256", secret()).update(`${purpose}:${value}`).digest("hex");
export const b64url = (b: Buffer) => b.toString("base64url");
export const pkceChallenge = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());

// ------------------------------------------------------------------------------------------
// National id numbers
// ------------------------------------------------------------------------------------------

/** Thai citizen id: 13 digits, the last a mod-11 check digit over the first twelve. */
export function validThaiId(id: string): boolean {
  if (!/^\d{13}$/.test(id) || id[0] === "0") return false;
  const sum = [...id.slice(0, 12)].reduce((t, d, i) => t + Number(d) * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

/** Chinese resident id (GB 11643-1999): 17 digits + an ISO 7064 MOD 11-2 check character. */
export function validChineseId(id: string): boolean {
  if (!/^\d{17}[\dX]$/.test(id)) return false;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = [...id.slice(0, 17)].reduce((t, d, i) => t + Number(d) * w[i], 0);
  return "10X98765432"[sum % 11] === id[17];
}

export const maskThaiId = (id: string) => `${id[0]}-${id.slice(1, 5)}-xxxxx-xx-${id[12]}`;

/** The 网号 a person has at the mock National Network Identity: stable, opaque, no id inside. */
export const netIdNumber = (residentId: string) => `WH${hmac("wanghao", residentId).slice(0, 12).toUpperCase()}`;

// ------------------------------------------------------------------------------------------
// Tokens (HS256, keys derived from MOCK_IDP_SECRET; a real provider publishes JWKS instead)
// ------------------------------------------------------------------------------------------

export type IdClaims =
  | { provider: "THAID"; pid: string; given_name: string; family_name: string; name_th: string; birthdate: string }
  | { provider: "CN_NETID"; wh: string; name_match: boolean };

export async function signIdToken(provider: KycProvider, claims: Record<string, unknown>, sub: string, nonce: string) {
  return new SignJWT({ ...claims, nonce })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(MOCK_ISSUER[provider])
    .setAudience(CLIENT_ID)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key(`id-token:${provider}`));
}

export async function verifyIdToken(provider: KycProvider, token: string, nonce: string) {
  const { payload } = await jwtVerify(token, key(`id-token:${provider}`), { issuer: MOCK_ISSUER[provider], audience: CLIENT_ID });
  if (payload.nonce !== nonce) throw new Error("nonce mismatch");
  return payload;
}

/** The relying party's state between /start and /callback, kept in an httpOnly cookie. */
export const KYC_COOKIE = "aw_kyc";
export async function signFlow(flow: { provider: KycProvider; state: string; nonce: string; verifier: string; uid: string }) {
  return new SignJWT(flow).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(key("kyc-flow"));
}
export async function readFlow(token: string) {
  const { payload } = await jwtVerify(token, key("kyc-flow"));
  return payload as unknown as { provider: KycProvider; state: string; nonce: string; verifier: string; uid: string };
}

export const randomToken = (bytes = 24) => b64url(randomBytes(bytes));

// ------------------------------------------------------------------------------------------
// Limits: what an unverified customer may do
// ------------------------------------------------------------------------------------------

export const LIMITS = {
  THB: { dealUnverified: 2_000, topupUnverified: 1_000, topupVerified: 50_000 },
  CNY: { dealUnverified: 400, topupUnverified: 200, topupVerified: 10_000 },
} as const;

export class KycRequired extends Error {}

export function kycOf(userId: string) {
  return db.kycVerification.findUnique({ where: { userId } });
}

/** Refuses a deal above the unverified limit until the user has verified their identity. */
export async function requireKycFor(userId: string, currency: "THB" | "CNY", amount: number) {
  const limit = LIMITS[currency].dealUnverified;
  if (amount <= limit) return;
  if (await kycOf(userId)) return;
  const id = currency === "THB" ? "ThaID" : "National Network Identity (国家网络身份认证)";
  throw new KycRequired(
    `Deals above ${limit.toLocaleString()} ${currency} need a verified identity. Verify with ${id} on the Profile page first (takes under a minute).`,
  );
}

/** Normalised name for matching an ID holder to the bank account holder. */
export const sameName = (a: string, b: string) => {
  const n = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return n(a) === n(b);
};
