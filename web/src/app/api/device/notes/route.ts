import { z } from "zod";

import { NoteError, addBuyerNote } from "@/lib/bank/deal-notes";
import { deviceWallet } from "@/lib/device-chain";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

const Body = z.object({
  dealId: z.number().int().min(0),
  index: z.number().int().min(0).max(20),
  text: z.string().trim().min(5).max(1000),
});

/** The buyer asks the seller for changes to a delivery under review, from the desktop app. */
export const POST = deviceRoute(async (device, body) => {
  const b = Body.safeParse(body);
  if (!b.success) throw new HttpError(400, "Say what should change (at least 5 characters)");
  const note = await addBuyerNote(deviceWallet(device), b.data.dealId, { kind: "CHANGES", index: b.data.index, text: b.data.text }).catch((e) => {
    throw e instanceof NoteError ? new HttpError(e.status, e.message) : e;
  });
  return { id: note.id };
}, { acting: true });
