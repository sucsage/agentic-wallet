import { cookies } from "next/headers";
import { publicOrigin } from "@/lib/origins";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { CLIENT_ID, KYC_COOKIE, clientSecret, readFlow, verifyIdToken } from "@/lib/kyc";
import { type KycInput, KycError, submitKyc } from "@/lib/onboarding";

/**
 * The ID provider sends the browser back here with a code. The app exchanges it at the provider's
 * token endpoint (server to server, with its client secret and the PKCE verifier), checks the
 * id_token (signature, issuer, audience, expiry, nonce) and that the identity is the bank account
 * holder, then records the verification. Only a hash and a masked id are kept.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const back = (result: string) => Response.redirect(new URL(`/chat?kyc=${encodeURIComponent(result)}`, origin), 303);
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
    const res = await fetch(new URL(`/api/mock-id/${slug}/token`, origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${origin}/api/kyc/callback`,
        client_id: CLIENT_ID,
        client_secret: clientSecret(),
        code_verifier: flow.verifier,
      }),
    });
    const token = (await res.json()) as { id_token?: string; error_description?: string };
    if (!res.ok || !token.id_token) return back(token.error_description ?? "The ID provider refused the code");
    const claims = await verifyIdToken(flow.provider, token.id_token, flow.nonce);

    // The digital ID's identity becomes the KYC application (approved at once in the demo).
    const user = await db.user.findUniqueOrThrow({ where: { id: flow.uid } });
    let input: KycInput;
    if (flow.provider === "THAID") {
      const name = `${claims.given_name ?? ""} ${claims.family_name ?? ""}`.trim();
      input = { method: "THAID", legalName: name || String(claims.name_th ?? user.name), pid: String(claims.pid ?? ""), birthDate: claims.birthdate ? String(claims.birthdate) : undefined };
    } else {
      if (claims.name_match !== true) return back("The National Network Identity holder is not the person who signed up (check the name).");
      input = { method: "CN_NETID", legalName: user.name, wh: String(claims.wh ?? "") };
    }
    const r = await submitKyc(flow.uid, input).catch((e) => {
      if (e instanceof KycError) return e.message;
      throw e;
    });
    if (typeof r === "string") return back(r);
    if (!r.customer) return back("pending");
    return back("ok");
  } catch (err) {
    console.error("kyc callback", err);
    return back("Verification failed. Start again.");
  }
}
