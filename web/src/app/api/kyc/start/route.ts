import { cookies } from "next/headers";

import { CLIENT_ID, KYC_COOKIE, kycOf, pkceChallenge, randomToken, signFlow } from "@/lib/kyc";
import { z } from "zod";

import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit, requireUser } from "@/lib/guard";
import { publicOrigin } from "@/lib/origins";

/**
 * Starts identity verification (OpenID Connect, authorization code + PKCE): remembers state,
 * nonce and the PKCE verifier in an httpOnly cookie and sends the browser to the national ID
 * provider for the customer's bank country.
 */
export async function POST(req: Request) {
  try {
    rateLimit(req, "kyc-start", 20, 60 * 60 * 1000);
    const user = await requireUser();
    if (await kycOf(user.id)) throw new HttpError(409, "Your identity is already verified");
    // The country chosen at onboarding (or the wallet's currency) picks the digital ID.
    const customer = await db.bankCustomer.findUnique({ where: { userId: user.id } });
    const body = z.object({ country: z.enum(["TH", "CN"]).optional() }).safeParse(await req.json().catch(() => ({})));
    const country = customer ? (customer.currency === "CNY" ? "CN" : "TH") : (body.success && body.data.country) || "TH";
    const provider = country === "TH" ? "THAID" : "CN_NETID";
    const flow = { provider, state: randomToken(), nonce: randomToken(), verifier: randomToken(32), uid: user.id } as const;
    (await cookies()).set(KYC_COOKIE, await signFlow(flow), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/kyc", maxAge: 600 });
    const origin = publicOrigin(req);
    const q = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: `${origin}/api/kyc/callback`,
      scope: provider === "THAID" ? "openid pid name birthdate" : "openid wh name_match",
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: pkceChallenge(flow.verifier),
      code_challenge_method: "S256",
      // The name the user signed up with: the ID provider checks it belongs to the ID holder.
      login_hint: customer?.displayName ?? user.name,
    });
    return Response.json({ url: `/mock-id/${provider === "THAID" ? "thaid" : "netid"}/authorize?${q}` });
  } catch (err) {
    return errorResponse(err);
  }
}
