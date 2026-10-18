import { finishDeviceSetup } from "@/lib/device-chain/account";
import { deviceRoute } from "@/lib/device-chain/route";

export const maxDuration = 120;

/** After the identity check: creates the agent wallet (once) and records it on the device. */
export const POST = deviceRoute((device) => finishDeviceSetup(device));
