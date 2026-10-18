import { discardDraft } from "@/lib/bank/drafts";
import { deviceDrafts, deviceWallet } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

/** Previews the AI drafted, waiting for Confirm (a signed block in the app). */
export const GET = deviceRoute(async (device) => ({ drafts: await deviceDrafts(device) }), { acting: true });

/** Discards a preview the user does not want (plain signed request: nothing is paid or locked). */
export const POST = deviceRoute(
  async (device, body) => {
    const id = (body as { discard?: unknown } | null)?.discard;
    if (typeof id !== "string" || id.length > 40) throw new HttpError(400, "Which preview?");
    if (!(await discardDraft(device.userId, deviceWallet(device), id))) throw new HttpError(404, "That preview is gone or already confirmed");
    return { drafts: await deviceDrafts(device) };
  },
  { acting: true },
);
