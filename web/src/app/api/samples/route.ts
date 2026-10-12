import { roleAddresses } from "@/lib/chain";
import { ATTACKER } from "@/lib/config";
import { errorResponse } from "@/lib/guard";
import { samples } from "@/lib/samples";

export async function GET() {
  try {
    return Response.json(samples(roleAddresses().contractor, ATTACKER));
  } catch (err) {
    return errorResponse(err);
  }
}
