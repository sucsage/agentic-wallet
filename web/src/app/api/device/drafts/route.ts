import { deviceDrafts } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";

/** Previews the AI drafted, waiting for Confirm (a signed block in the app). */
export const GET = deviceRoute(async (device) => ({ drafts: await deviceDrafts(device) }));
