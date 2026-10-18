import { z } from "zod";

import { BuyerInviteError, buyerInviteByToken } from "@/lib/bank/buyer-invites";
import { InviteError, inviteForRequest } from "@/lib/bank/invites";
import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";
import { type LinkKind, accessState, setupWithOtp, signInWithPassword, startReset } from "@/lib/link-access";

/**
 * Opening a private link (lib/link-access): `setup` with the one-time code and a new password,
 * `login` with the password, or `forgot` for a reset code to send to the person who made the link.
 * kind: "invite" (a seller's link) or "pay" (a buyer's link).
 */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup"), otp: z.string().max(12), password: z.string().max(100) }),
  z.object({ action: z.literal("login"), password: z.string().max(100) }),
  z.object({ action: z.literal("forgot") }),
]);

async function lookup(kind: string, token: string) {
  if (kind === "invite") {
    const invite = await inviteForRequest(token, null, { skipAccess: true }).catch((e) => {
      throw e instanceof InviteError ? new HttpError(404, e.message) : e;
    });
    return { k: "seller" as LinkKind, invite };
  }
  if (kind === "pay") {
    const invite = await buyerInviteByToken(token).catch((e) => {
      throw e instanceof BuyerInviteError ? new HttpError(404, e.message) : e;
    });
    return { k: "buyer" as LinkKind, invite };
  }
  throw new HttpError(404, "Unknown link");
}

export async function GET(req: Request, ctx: RouteContext<"/api/link-access/[kind]/[token]">) {
  try {
    rateLimit(req, "link-access-view", 120, 60 * 60 * 1000);
    const p = await ctx.params;
    const { invite } = await lookup(p.kind, p.token);
    const inviter = await db.user.findUnique({ where: { id: invite.userId }, select: { name: true } });
    return Response.json({ state: accessState(invite), name: invite.name, inviter: inviter?.name ?? "the person who sent the link" });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, ctx: RouteContext<"/api/link-access/[kind]/[token]">) {
  try {
    rateLimit(req, "link-access", 30, 60 * 60 * 1000);
    const p = await ctx.params;
    const { k, invite } = await lookup(p.kind, p.token);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new HttpError(400, "Enter the code and a password");
    const b = body.data;
    if (b.action === "setup") await setupWithOtp(k, invite, b.otp, b.password);
    else if (b.action === "login") await signInWithPassword(k, invite, b.password);
    else {
      const { code, until } = await startReset(k, invite);
      return Response.json({ resetCode: code, until });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
