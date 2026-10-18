import { setupStatus } from "@/lib/device-chain/account";
import { deviceRoute } from "@/lib/device-chain/route";

/** Where an account made in the app is in setting up: identity, account, wallet. */
export const GET = deviceRoute((device) => setupStatus(device));
