import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { CLIENT_ID, KYC_COOKIE, clientSecret, hmac, maskThaiId, readFlow, sameName, verifyIdToken } from "@/lib/kyc";

/**
 * The ID provider sends the browser back here with a code. The app exchanges it at the provider's
 * token endpoint (server to server, with its client secret and the PKCE verifier), checks the
 * id_token (signature, issuer, audience, expiry, nonce) and that the identity is the bank account
 * holder, then records the verification. Only a hash and a masked id are kept.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (result: string) => Response.redirect(new URL(`/profile?kyc=${encodeURIComponent(result)}`, url.origin), 303);
  const jar = await cookies();
  const raw = jar.get(KYC_COOKIE)?.value;
  jar.delete({ name: KYC_COOKIE, path: "/api/kyc" });
  try {
    if (url.searchParams.get("error")) return back(url.searchParams.get("error_description") ?? "Verification was cancelled");
    if (!raw) return back("The verification expired. Start again.");
    const flow = await readFlow(raw);
    const session = await getSession();
    if (!session || session.user.id !== flow.uid) return back("Sign in again, then verify.");
    if (url.searchParams.get("state") !== flow.state) return back("Invalid state");
    const code = url.searchParams.get("code");
    if (!code) return back("No authorization code");

    const slug = flow.provider === "THAID" ? "thaid" : "netid";
    const res = await fetch(new URL(`/api/mock-id/${slug}/token`, url.origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${url.origin}/api/kyc/callback`,
        client_id: CLIENT_ID,
        client_secret: clientSecret(),
        code_verifier: flow.verifier,
      }),
    });
    const token = (await res.json()) as { id_token?: string; error_description?: string };
    if (!res.ok || !token.id_token) return back(token.error_description ?? "The ID provider refused the code");
    const claims = await verifyIdToken(flow.provider, token.id_token, flow.nonce);

    const customer = await db.bankCustomer.findFirst({ where: { userId: flow.uid } });
    if (!customer) return back("No bank customer for this account");
    let subject: string;
    let masked: string;
    if (flow.provider === "THAID") {
      const pid = String(claims.pid ?? "");
      const nameEn = `${claims.given_name ?? ""} ${claims.family_name ?? ""}`;
      if (!sameName(nameEn, customer.displayName) && !sameName(String(claims.name_th ?? ""), customer.displayName)) {
        return back(`The ThaID holder (${nameEn.trim()}) is not the bank account holder (${customer.displayName}).`);
      }
      subject = hmac("kyc:THAID", pid);
      masked = maskThaiId(pid);
    } else {
      if (claims.name_match !== true) return back("The National Network Identity holder is not the bank account holder.");
      const wh = String(claims.wh ?? "");
      subject = hmac("kyc:CN_NETID", wh);
      masked = `${wh.slice(0, 2)}••••${wh.slice(-4)}`;
    }
    const taken = await db.kycVerification.findUnique({ where: { subjectHash: subject } });
    if (taken && taken.userId !== flow.uid) return back("This identity already verified another account.");
    await db.kycVerification.upsert({
      where: { userId: flow.uid },
      update: {},
      create: { userId: flow.uid, provider: flow.provider, subjectHash: subject, maskedId: masked, verifiedName: customer.displayName },
    });
    return back("ok");
  } catch (err) {
    console.error("kyc callback", err);
    return back("Verification failed. Start again.");
  }
}
