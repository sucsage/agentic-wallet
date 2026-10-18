import { z } from "zod";

import { deviceSettings, revokeDevice, setDeviceSigns } from "@/lib/device-chain";
import { db } from "@/lib/db";
import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";

/** Removes a device (lost or old computer): its requests are refused from now on. */
export async function POST(req: Request) {
  try {
    const { user } = await requireCustomer();
    const parsed = z.object({ address: z.string() }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    await revokeDevice(user.id, parsed.data.address).catch((e) => {
      throw e instanceof Error ? new HttpError(404, e.message) : e;
    });
    // The last device gone: website moves no longer wait for one.
    if (!(await db.device.findFirst({ where: { userId: user.id, revokedAt: null } }))) await setDeviceSigns(user.id, false);
    return Response.json(await deviceSettings(user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
