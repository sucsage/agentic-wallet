import { usageOf } from "@/lib/ai-usage";
import { deviceRoute } from "@/lib/device-chain/route";

/** The AI allowance for the desktop app (tokens on the team's key; the user's own key is not limited). */
export const GET = deviceRoute((device) => usageOf(device.userId));
