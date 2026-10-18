import { runDue } from "@/lib/bank/due-route";
import { deviceWallet } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";

/** Milestone due dates from the desktop app (propose, accept, late refund request). */
export const POST = deviceRoute(async (device, body) => runDue(deviceWallet(device), Number((body as { dealId?: unknown } | null)?.dealId), body), { acting: true });
