import { deviceDeals } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";

export const maxDuration = 60;

export const GET = deviceRoute((device) => deviceDeals(device).then((deals) => ({ deals })));
