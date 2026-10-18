import { anchorProof } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";

/** The latest public anchor holding one of this device's heads, with its Merkle proof. */
export const GET = deviceRoute(async (device) => ({ anchor: await anchorProof(device) }));
