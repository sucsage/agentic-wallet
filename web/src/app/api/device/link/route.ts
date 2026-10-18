import { z } from "zod";

import { linkDevice } from "@/lib/device-chain";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

const Body = z.object({ code: z.string().min(4).max(20), address: z.string(), name: z.string().max(80), os: z.string().max(40), sig: z.string().max(200) });

/** The desktop app links itself with the code from the website, proving it holds its device key. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "device-link", 10, 15 * 60 * 1000);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    return Response.json(await linkDevice(parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
