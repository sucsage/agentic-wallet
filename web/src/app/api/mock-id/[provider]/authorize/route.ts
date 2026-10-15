import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";
import { CLIENT_ID, maskThaiId, netIdNumber, sameName, validChineseId, validThaiId } from "@/lib/kyc";

/**
 * MOCK identity provider, authorization step. Stands in for the user approving the request in the
 * ThaID app (or the 国家网络身份认证 app) after scanning the QR code: it checks the identity the demo
 * user typed and issues a single-use code bound to the client, redirect URI, PKCE challenge and
 * nonce. Demo only: no real government system is contacted, and no id number is stored.
 */
const Body = z.object({
  client_id: z.literal(CLIENT_ID),
  redirect_uri: z.string().url(),
  state: z.string().min(8).max(200),
  nonce: z.string().min(8).max(200),
  code_challenge: z.string().min(40).max(100),
  login_hint: z.string().max(120).default(""),
  approve: z.boolean(),
  identity: z.object({
    id: z.string().trim().max(20),
    given_name: z.string().trim().max(60).default(""),
    family_name: z.string().trim().max(60).default(""),
    full_name: z.string().trim().max(120).default(""),
    birthdate: z.string().max(10).default(""),
  }),
});

export async function POST(req: Request, ctx: RouteContext<"/api/mock-id/[provider]/authorize">) {
  try {
    rateLimit(req, "mock-id", 30, 60 * 60 * 1000);
    const provider = (await ctx.params).provider === "thaid" ? "THAID" : (await ctx.params).provider === "netid" ? "CN_NETID" : null;
    if (!provider) throw new HttpError(404, "Unknown provider");
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "invalid_request");
    const b = parsed.data;
    const redirect = new URL(b.redirect_uri);
    // Registered redirect URI: this app's callback only.
    if (redirect.origin !== new URL(req.url).origin || redirect.pathname !== "/api/kyc/callback") throw new HttpError(400, "redirect_uri is not registered");
    const back = (params: Record<string, string>) => {
      for (const [k, v] of Object.entries(params)) redirect.searchParams.set(k, v);
      redirect.searchParams.set("state", b.state);
      return Response.json({ redirect: redirect.toString() });
    };
    if (!b.approve) return back({ error: "access_denied", error_description: "You declined in the ID app" });

    const id = b.identity.id.replace(/[\s-]/g, "").toUpperCase();
    let claims: Record<string, unknown>;
    if (provider === "THAID") {
      if (!validThaiId(id)) throw new HttpError(400, "Not a valid Thai citizen id (13 digits; the last is a check digit)");
      if (!b.identity.given_name || !b.identity.family_name) throw new HttpError(400, "Enter the name as on the ID card");
      claims = {
        pid: id,
        given_name: b.identity.given_name,
        family_name: b.identity.family_name,
        name_th: b.identity.full_name,
        birthdate: b.identity.birthdate,
        masked: maskThaiId(id),
      };
    } else {
      if (!validChineseId(id)) throw new HttpError(400, "Not a valid resident id (18 characters; the last is a check character)");
      if (!b.identity.full_name) throw new HttpError(400, "Enter the name as on the ID card");
      // Privacy by design: the relying party learns the 网号 and whether the name it asked about
      // (login_hint) is the holder's, never the id number or the name itself.
      claims = { wh: netIdNumber(id), name_match: sameName(b.identity.full_name, b.login_hint) };
    }
    const code = randomBytes(24).toString("base64url");
    await db.mockIdCode.create({
      data: {
        id: createHash("sha256").update(code).digest("hex"),
        provider,
        clientId: b.client_id,
        redirectUri: b.redirect_uri,
        codeChallenge: b.code_challenge,
        nonce: b.nonce,
        claims: claims as object,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    return back({ code });
  } catch (err) {
    return errorResponse(err);
  }
}
