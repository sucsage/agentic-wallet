import { z } from "zod";

import { HttpError, errorResponse, rateLimit, requireUser } from "@/lib/guard";
import { AddressError, formatAddress, saveAddress, savedAddress } from "@/lib/thai-address";

/** The user's saved delivery address. */
export async function GET() {
  try {
    const user = await requireUser();
    const a = await savedAddress(user.id);
    return Response.json({ address: a, text: a ? formatAddress(a) : null });
  } catch (err) {
    return errorResponse(err);
  }
}

const Input = z.object({
  recipient: z.string().max(120),
  phone: z.string().max(20),
  line: z.string().max(200),
  subdistrict: z.string().max(80),
  district: z.string().max(80),
  province: z.string().max(80),
  postcode: z.string().max(5).default(""),
});

export async function PUT(req: Request) {
  try {
    rateLimit(req, "address", 30, 60 * 60 * 1000);
    const user = await requireUser();
    const body = Input.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Fill in every part of the address");
    const a = await saveAddress(user.id, body.data).catch((e) => {
      throw e instanceof AddressError ? new HttpError(400, e.message) : e;
    });
    return Response.json({ address: a, text: formatAddress(a) });
  } catch (err) {
    return errorResponse(err);
  }
}
