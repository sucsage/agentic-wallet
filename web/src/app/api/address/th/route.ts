import TH from "@/data/th-address.json";

/** The Thai province → district → sub-district → postcode list, for the address pickers. Public data. */
export function GET() {
  return Response.json(TH, { headers: { "cache-control": "public, max-age=86400, s-maxage=604800, immutable" } });
}
