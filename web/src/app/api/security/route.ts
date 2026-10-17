import { z } from "zod";

import { getSession } from "@/lib/auth";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";
import {
  METHODS,
  TwoFactorError,
  addCredential,
  publicSecurity,
  securityOf,
  setMethods,
  setPhone,
  setPin,
  startCode,
  twoFactorPassed,
  verify,
} from "@/lib/two-factor";

async function session() {
  const s = await getSession();
  if (!s) throw new HttpError(401, "Sign in first");
  return s;
}

/** 2FA status: which methods are on, and whether this session passed. */
export async function GET() {
  try {
    const s = await session();
    const sec = await securityOf(s.user.id);
    return Response.json({ ...publicSecurity(sec), verified: await twoFactorPassed(s.user.id, s.session.id), email: s.user.email.replace(/^(.).*(@.*)$/, "$1•••$2") });
  } catch (err) {
    return errorResponse(err);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pin"), pin: z.string().max(12) }),
  z.object({ action: z.literal("phone"), phone: z.string().max(30) }),
  z.object({ action: z.literal("device"), credentialId: z.string().max(1024) }),
  z.object({ action: z.literal("methods"), methods: z.array(z.enum(METHODS)).max(6) }),
  z.object({ action: z.literal("code"), method: z.enum(["email", "sms"]) }),
  z.object({ action: z.literal("verify"), method: z.enum(METHODS), secret: z.string().max(1024) }),
]);

/**
 * Sets up or passes 2FA. Changing the setup needs this session to have passed 2FA already (or 2FA
 * to be off), so a stolen session cannot switch it off.
 */
export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Invalid request");
    const b = body.data;
    rateLimit(req, b.action === "verify" || b.action === "code" ? "2fa-verify" : "2fa-setup", 30, 15 * 60 * 1000);
    const s = await session();
    const uid = s.user.id;
    const passed = await twoFactorPassed(uid, s.session.id);
    if (b.action !== "verify" && b.action !== "code" && !passed) throw new HttpError(403, "Verify it's you first");
    const run = async () => {
      switch (b.action) {
        case "pin":
          return setPin(uid, b.pin);
        case "phone":
          return setPhone(uid, b.phone);
        case "device":
          return addCredential(uid, b.credentialId);
        case "methods":
          return setMethods(uid, b.methods, s.session.id);
        case "code":
          return startCode(uid, s.user.email, b.method);
        case "verify":
          return verify(uid, s.session.id, b.method, b.secret);
      }
    };
    const out = await run().catch((e) => {
      throw e instanceof TwoFactorError ? new HttpError(400, e.message) : e;
    });
    const sec = await securityOf(uid);
    return Response.json({ ok: true, ...(out && typeof out === "object" ? out : {}), status: { ...publicSecurity(sec), verified: await twoFactorPassed(uid, s.session.id) } });
  } catch (err) {
    return errorResponse(err);
  }
}
