import { z } from "zod";

import { deviceSettings, setDeviceSigns } from "@/lib/device-chain";
import { HttpError, errorResponse, requireCustomer } from "@/lib/guard";

/** Profile → Desktop app: linked devices and whether website moves wait for the app's signature. */
export async function GET() {
  try {
    const { user } = await requireCustomer();
    return Response.json(await deviceSettings(user.id));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireCustomer();
    const parsed = z.object({ deviceSigns: z.boolean() }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    await setDeviceSigns(user.id, parsed.data.deviceSigns);
    return Response.json(await deviceSettings(user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
