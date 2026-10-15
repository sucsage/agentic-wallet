import { cookies } from "next/headers";

import { CLIENT_ID, KYC_COOKIE, kycOf, pkceChallenge, randomToken, signFlow } from "@/lib/kyc";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

/**
 * Starts identity verification (OpenID Connect, authorization code + PKCE): remembers state,
 * nonce and the PKCE verifier in an httpOnly cookie and sends the browser to the national ID
 * provider for the customer's bank country.
 */
export async function POST(req: Request) {
  try {
    rateLimit(req, "kyc-start", 20, 60 * 60 * 1000);
    const { user, customer } = await requireCustomer();
    if (await kycOf(user.id)) throw new HttpError(409, "Your identity is already verified");
    const provider = customer.currency === "THB" ? "THAID" : "CN_NETID";
    const flow = { provider, state: randomToken(), nonce: randomToken(), verifier: randomToken(32), uid: user.id } as const;
    (await cookies()).set(KYC_COOKIE, await signFlow(flow), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/kyc", maxAge: 600 });
    const origin = new URL(req.url).origin;
    const q = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: `${origin}/api/kyc/callback`,
      scope: provider === "THAID" ? "openid pid name birthdate" : "openid wh name_match",
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: pkceChallenge(flow.verifier),
      code_challenge_method: "S256",
      // The name on the bank account: the ID provider checks it belongs to the same person.
      login_hint: customer.displayName,
    });
    return Response.json({ url: `/mock-id/${provider === "THAID" ? "thaid" : "netid"}/authorize?${q}` });
  } catch (err) {
    return errorResponse(err);
  }
}
