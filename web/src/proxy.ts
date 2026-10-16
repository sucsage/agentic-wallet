import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Runs before every page and API request (Next.js 16 Proxy, formerly Middleware):
 *
 * 1. App pages without a session cookie go to /login?next=…. Optimistic only: it reads the cookie,
 *    never the database (a stale cookie passes, and the app sends that user to /login itself; the
 *    proxy never redirects away from /login, so the two can never loop). Every route handler still checks
 *    the session and the wallet itself (src/lib/guard.ts); this only saves a flash of an empty app.
 * 2. Security headers on every response. Pages whose URL carries a secret (a seller's or buyer's invite link,
 *    a password-reset token, a group join link) send no Referer, so the secret never leaks to
 *    another site through a clicked link or a loaded resource.
 * 3. A state-changing API call (POST, PUT, PATCH, DELETE) from another site's page is refused
 *    (CSRF). Calls without an Origin header (servers, webhooks, scripts) pass, as do /api/auth
 *    routes: Better Auth checks origins itself, and Sign in with Apple returns by a cross-site POST.
 */

/** Pages that need a signed-in user (the app). Everything else is public. */
const APP_PAGES = [
  "/chat",
  "/deals",
  "/deal",
  "/approvals",
  "/summary",
  "/contacts",
  "/friends",
  "/groups",
  "/group",
  "/policy",
  "/profile",
  "/w",
  "/admin",
];

/** Public pages under an app prefix: joining a group by link starts signed out. */
const PUBLIC_UNDER_APP = ["/groups/join/"];

/** Pages whose URL holds a secret token. */
const SECRET_URLS = ["/invite/", "/pay/", "/reset-password", "/groups/join/", "/api/auth/reset-password/"];

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const under = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));

function withHeaders(res: NextResponse, req: NextRequest): NextResponse {
  const path = req.nextUrl.pathname;
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", SECRET_URLS.some((p) => path.startsWith(p)) ? "no-referrer" : "strict-origin-when-cross-origin");
  // The QR scanners read photos (file input), so no live camera access is needed.
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (req.nextUrl.protocol === "https:") res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return res;
}

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (path.startsWith("/api/")) {
    if (UNSAFE.has(req.method) && !path.startsWith("/api/auth/")) {
      const origin = req.headers.get("origin");
      if (origin && origin !== req.nextUrl.origin) {
        return withHeaders(NextResponse.json({ error: "Cross-site request refused" }, { status: 403 }), req);
      }
    }
    return withHeaders(NextResponse.next(), req);
  }

  const signedIn = Boolean(getSessionCookie(req));
  if (!signedIn && under(path, APP_PAGES) && !under(path, PUBLIC_UNDER_APP)) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", `${path}${req.nextUrl.search}`);
    return withHeaders(NextResponse.redirect(login), req);
  }
  return withHeaders(NextResponse.next(), req);
}

export const config = {
  // Not for static files and images (no session or headers needed there).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|woff2?)$).*)"],
};
