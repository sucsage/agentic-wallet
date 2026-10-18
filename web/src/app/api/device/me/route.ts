import { deviceAccount } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";

export const GET = deviceRoute((device) => deviceAccount(device), { acting: true });
