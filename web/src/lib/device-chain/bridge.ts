import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { type Hex, getAddress, isAddress, isHex, keccak256 } from "viem";

import { requestMessage, signerOf } from "./format";

/**
 * The desktop app reaches the website's own API (templates, summary, policy, profile, groups…) with
 * the same signed requests it uses for /api/device: x-aw-device, x-aw-time and x-aw-sig over the
 * method, the path with its query, the time and the body's bytes. The proxy checks the signature and
 * the body before any route runs and hands the route a sealed header (x-aw-verified, HMAC with the
 * server secret); getSession() turns that into a session for the device's user, after checking the
 * device is still linked and the signature was not used before. "Act as" a group travels in the
 * signed query as aw_as=<company id>.
 */

export const VERIFIED_HEADER = "x-aw-verified";
const MAX_SKEW_MS = 5 * 60 * 1000;

const secret = () => process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || "dev-only-bridge-secret";
const mac = (payload: string) => createHmac("sha256", secret()).update(`aw-bridge\n${payload}`).digest("base64url");

export type Verified = { device: string; time: number; sigHash: Hex; acting: string | null; nonce: string };

/** In the proxy: checks a signed request and returns the sealed header value, or an error. */
export async function verifySignedRequest(req: Request): Promise<{ header: string } | { error: string }> {
  const address = req.headers.get("x-aw-device") ?? "";
  const time = Number(req.headers.get("x-aw-time"));
  const sig = req.headers.get("x-aw-sig") ?? "";
  if (!isAddress(address) || !Number.isFinite(time) || !isHex(sig)) return { error: "Unsigned request" };
  if (Math.abs(Date.now() - time) > MAX_SKEW_MS) return { error: "Your computer's clock is off by more than 5 minutes" };
  const url = new URL(req.url);
  const body = req.method === "GET" || req.method === "HEAD" ? new Uint8Array() : new Uint8Array(await req.clone().arrayBuffer());
  const signer = await signerOf(requestMessage(req.method, url.pathname + url.search, time, body), sig as Hex).catch(() => null);
  if (signer !== getAddress(address)) return { error: "Bad device signature" };
  const acting = url.searchParams.get("aw_as");
  // nonce: one per request, so the replay check can tell this request's own guards from a replay.
  const payload = [getAddress(address), time, keccak256(sig as Hex), acting && /^[\w-]{1,40}$/.test(acting) ? acting : "", randomBytes(12).toString("base64url")].join(".");
  return { header: `${payload}.${mac(payload)}` };
}

/** In getSession: reads the sealed header the proxy set (never one a client sent: the proxy strips those). */
export function readVerified(value: string | null): Verified | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 6) return null;
  const [device, time, sigHash, acting, nonce, tag] = parts;
  const want = mac(parts.slice(0, 5).join("."));
  if (tag.length !== want.length || !timingSafeEqual(Buffer.from(tag), Buffer.from(want))) return null;
  if (!isAddress(device) || !isHex(sigHash)) return null;
  return { device: getAddress(device), time: Number(time), sigHash: sigHash as Hex, acting: acting || null, nonce };
}
