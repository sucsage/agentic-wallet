import { z } from "zod";

import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";
import { SocialError, setUsername } from "@/lib/social";

const Body = z.object({ username: z.string().min(2).max(40) });

/** Chooses the username friends find this user by (replacing the automatic w_… one). */
export async function POST(req: Request) {
  try {
    rateLimit(req, "set-username", 20, 60 * 60 * 1000);
    const { user } = await requireCustomer();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Enter a username");
    return Response.json(
      await setUsername(user.id, parsed.data.username).catch((e) => {
        throw e instanceof SocialError ? new HttpError(400, e.message) : e;
      }),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
