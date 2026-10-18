import { z } from "zod";

import { loginFromDevice } from "@/lib/device-chain/account";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

const Body = z.object({ email: z.string().max(200), password: z.string().max(128), address: z.string(), deviceName: z.string().max(80), os: z.string().max(40), sig: z.string().max(200) });

/** Sign in from the desktop app (email + password): links the device that signed the email. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "device-login", 10, 15 * 60 * 1000);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    return Response.json(await loginFromDevice(parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
