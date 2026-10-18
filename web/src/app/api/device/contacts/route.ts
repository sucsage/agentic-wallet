import { deviceContacts } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";

export const maxDuration = 60;

/** Friends and payees; turning a payee on or off is a signed block (intent "payee"). */
export const GET = deviceRoute(async (device) => ({ contacts: await deviceContacts(device) }));
