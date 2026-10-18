import { deviceActivity } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";

/** Money in and out of the wallet's account (top-ups, deals, transfers). */
export const GET = deviceRoute((device) => deviceActivity(device), { acting: true });
