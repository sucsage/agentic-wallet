import { db } from "@/lib/db";
import { HttpError, errorResponse, rateLimit, requireCustomer } from "@/lib/guard";

/**
 * Finds customers of the same bank by part of their username or display name (at least 2
 * characters, at most 6 results), so a friend can be found without typing the exact username.
 */
export async function GET(req: Request) {
  try {
    rateLimit(req, "friend-search", 120, 60 * 60 * 1000);
    const { user, customer } = await requireCustomer();
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2 || q.length > 80) throw new HttpError(400, "Type at least 2 characters");
    // An exact email finds that person (never a partial match: emails are not browsable).
    if (q.includes("@")) {
      const u = await db.user.findFirst({ where: { email: q.toLowerCase(), id: { not: user.id } }, select: { bankCustomer: { select: { username: true, displayName: true, currency: true } } } });
      const c = u?.bankCustomer;
      return Response.json({ results: c && c.currency === customer.currency ? [{ username: c.username, name: c.displayName }] : [] });
    }
    const rows = await db.bankCustomer.findMany({
      where: {
        currency: customer.currency,
        userId: { not: null, notIn: [user.id] },
        OR: [{ username: { contains: q.toLowerCase() } }, { displayName: { contains: q, mode: "insensitive" } }],
      },
      select: { username: true, displayName: true },
      orderBy: { username: "asc" },
      take: 6,
    });
    return Response.json({ results: rows.map((r) => ({ username: r.username, name: r.displayName })) });
  } catch (err) {
    return errorResponse(err);
  }
}
