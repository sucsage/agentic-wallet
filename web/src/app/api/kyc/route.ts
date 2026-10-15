import { LIMITS, kycOf } from "@/lib/kyc";
import { errorResponse, requireCustomer } from "@/lib/guard";

/** The signed-in customer's identity verification and what it unlocks. */
export async function GET() {
  try {
    const { user, customer } = await requireCustomer();
    const kyc = await kycOf(user.id);
    const currency = customer.currency;
    return Response.json({
      currency,
      provider: currency === "THB" ? "THAID" : "CN_NETID",
      verified: kyc
        ? { provider: kyc.provider, maskedId: kyc.maskedId, name: kyc.verifiedName, at: kyc.verifiedAt }
        : null,
      limits: LIMITS[currency],
    });
  } catch (err) {
    return errorResponse(err);
  }
}
