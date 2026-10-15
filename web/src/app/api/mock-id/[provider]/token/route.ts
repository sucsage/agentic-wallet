import { createHash, timingSafeEqual } from "node:crypto";

import { db } from "@/lib/db";
import { CLIENT_ID, clientSecret, pkceChallenge, signIdToken } from "@/lib/kyc";

/**
 * MOCK identity provider, token endpoint (OpenID Connect, authorization_code grant). Checks the
 * client credentials, the code (single use, 5 minutes), the redirect URI and the PKCE verifier, then
 * returns an id_token. Server to server only; the browser never sees it.
 */
const fail = (error: string, description: string, status = 400) => Response.json({ error, error_description: description }, { status });

export async function POST(req: Request, ctx: RouteContext<"/api/mock-id/[provider]/token">) {
  const slug = (await ctx.params).provider;
  const provider = slug === "thaid" ? "THAID" : slug === "netid" ? "CN_NETID" : null;
  if (!provider) return fail("invalid_request", "Unknown provider", 404);
  const f = new URLSearchParams(await req.text());
  if (f.get("grant_type") !== "authorization_code") return fail("unsupported_grant_type", "authorization_code only");
  const secret = Buffer.from(f.get("client_secret") ?? "");
  const expected = Buffer.from(clientSecret());
  if (f.get("client_id") !== CLIENT_ID || secret.length !== expected.length || !timingSafeEqual(secret, expected)) {
    return fail("invalid_client", "Client authentication failed", 401);
  }
  const id = createHash("sha256").update(f.get("code") ?? "").digest("hex");
  // Claim the code atomically: a second exchange of the same code finds nothing to update.
  const claimed = await db.mockIdCode.updateMany({ where: { id, provider, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) return fail("invalid_grant", "The code is invalid, expired or already used");
  const row = await db.mockIdCode.findUniqueOrThrow({ where: { id } });
  if (row.redirectUri !== f.get("redirect_uri")) return fail("invalid_grant", "redirect_uri mismatch");
  if (pkceChallenge(f.get("code_verifier") ?? "") !== row.codeChallenge) return fail("invalid_grant", "PKCE verification failed");
  const claims = row.claims as Record<string, unknown>;
  const sub = String(provider === "THAID" ? claims.pid : claims.wh);
  const { masked: _masked, ...released } = claims;
  // The identity leaves with the id_token; the provider keeps no copy, and expired codes are purged.
  await db.mockIdCode.update({ where: { id }, data: { claims: {} } });
  await db.mockIdCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } });
  return Response.json({
    token_type: "Bearer",
    access_token: `mock_${id.slice(0, 32)}`,
    expires_in: 300,
    scope: provider === "THAID" ? "openid pid name birthdate" : "openid wh name_match",
    id_token: await signIdToken(provider, released, sub, row.nonce),
  });
}
