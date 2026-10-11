import { samples } from "@/lib/samples";

// Fictional fixtures only; no roles, recipients, or addresses are loaded from chain config.
export async function GET() {
  return Response.json(samples("0x000000000000000000000000000000000000cafe", "0x000000000000000000000000000000000000bad0"));
}
