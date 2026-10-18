import { z } from "zod";

import { signupFromDevice } from "@/lib/device-chain/account";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

const Body = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email().max(200),
  password: z.string().min(8).max(128),
  address: z.string(),
  deviceName: z.string().max(80),
  os: z.string().max(40),
  sig: z.string().max(200),
});

/** A new account made in the desktop app, linked to the device that signed its email. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "device-signup", 5, 60 * 60 * 1000);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
    return Response.json(await signupFromDevice(parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
