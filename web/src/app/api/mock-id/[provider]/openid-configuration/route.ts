import { MOCK_ISSUER } from "@/lib/kyc";

/** Discovery document of a mock identity provider (what a real one serves at /.well-known). */
export async function GET(req: Request, ctx: RouteContext<"/api/mock-id/[provider]/openid-configuration">) {
  const slug = (await ctx.params).provider;
  if (slug !== "thaid" && slug !== "netid") return Response.json({ error: "not_found" }, { status: 404 });
  const origin = new URL(req.url).origin;
  const thai = slug === "thaid";
  return Response.json({
    issuer: MOCK_ISSUER[thai ? "THAID" : "CN_NETID"],
    authorization_endpoint: `${origin}/mock-id/${slug}/authorize`,
    token_endpoint: `${origin}/api/mock-id/${slug}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    id_token_signing_alg_values_supported: ["HS256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    scopes_supported: thai ? ["openid", "pid", "name", "birthdate"] : ["openid", "wh", "name_match"],
    claims_supported: thai ? ["sub", "pid", "given_name", "family_name", "name_th", "birthdate"] : ["sub", "wh", "name_match"],
    note: "Demo identity provider inside Agentic Wallet. Not connected to DOPA or the Ministry of Public Security.",
  });
}
