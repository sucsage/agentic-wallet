import { startDeviceKyc } from "@/lib/device-chain/account";
import { deviceRoute } from "@/lib/device-chain/route";
import { publicOrigin } from "@/lib/origins";

/** The national digital ID page the app opens in the browser (mock ThaID / mock 网号, OIDC + PKCE). */
export const POST = deviceRoute(async (device, body, req) => {
  const country = (body as { country?: string } | null)?.country === "CN" ? "CN" : "TH";
  return startDeviceKyc(device, publicOrigin(req), country);
});
