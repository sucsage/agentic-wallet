import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { hmac } from "./kyc";

/**
 * Invite links are credentials: the database keeps their hash to check them, and this sealed copy
 * (AES-256-GCM, key derived from a server secret) only so the person who made the link can see it
 * again on the deal's page.
 */
const key = () => Buffer.from(hmac("invite-link-seal", "v1"), "hex");

export function sealToken(token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function openToken(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
