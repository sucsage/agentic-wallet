import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { VERIFIED_HEADER, verifySignedRequest } from "./lib/device-chain/bridge";
import { publicOrigin, siteOrigins } from "./lib/origins";

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

/** Sandboxed previews of a delivered web page (framed by the deal page / buyer link page only). */
const SITE_PREVIEW = /^\/api\/(deals\/\d+|pay\/[^/]+)\/site\//;

/** Work files (PDFs, images) previewed inside this app's own pages: framing allowed from this origin only. */
const FILE_PREVIEW = /^\/api\/(deals\/\d+\/(attachments|files)\/|posts\/(files\/|[^/]+\/files\/)|apply\/[^/]+\/files\/|pay\/[^/]+\/(deal-files|files)\/|invite\/[^/]+\/deal-files\/)/;

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const under = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));

function withHeaders(res: NextResponse, req: NextRequest): NextResponse {
  const path = req.nextUrl.pathname;
  res.headers.set("X-Content-Type-Options", "nosniff");
  // Delivered websites are previewed in a device mockup inside this app (their own CSP sandboxes them).
  res.headers.set("X-Frame-Options", SITE_PREVIEW.test(path) || FILE_PREVIEW.test(path) ? "SAMEORIGIN" : "DENY");
  res.headers.set("Referrer-Policy", SECRET_URLS.some((p) => path.startsWith(p)) ? "no-referrer" : "strict-origin-when-cross-origin");
  // The QR scanners read photos (file input), so no live camera access is needed.
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (req.nextUrl.protocol === "https:") res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return res;
}

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // One address for search engines and cookies: kravii.com → www.kravii.com.
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (host === "kravii.com") return NextResponse.redirect(`https://www.kravii.com${path}${req.nextUrl.search}`, 308);

  if (path.startsWith("/api/")) {
    if (UNSAFE.has(req.method) && !path.startsWith("/api/auth/")) {
      const origin = req.headers.get("origin");
      // Behind a proxy or tunnel the request URL is the container's (http://…), so the site's public
      // addresses and the forwarded host count as this site too.
      const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      const fwd = fwdHost ? `${req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https"}://${fwdHost}` : null;
      if (origin && origin !== req.nextUrl.origin && origin !== fwd && !siteOrigins().includes(origin)) {
        return withHeaders(NextResponse.json({ error: "Cross-site request refused" }, { status: 403 }), req);
      }
    }
    const headers = new Headers(req.headers);
    headers.delete(VERIFIED_HEADER);
    // The desktop app's signed call to a website route (its own /api/device routes check themselves).
    if (headers.has("x-aw-device") && !path.startsWith("/api/device/") && !path.startsWith("/api/auth/")) {
      const v = await verifySignedRequest(req);
      if ("error" in v) return withHeaders(NextResponse.json({ error: v.error }, { status: 401 }), req);
      headers.set(VERIFIED_HEADER, v.header);
    }
    return withHeaders(NextResponse.next({ request: { headers } }), req);
  }

  const signedIn = Boolean(getSessionCookie(req));
  if (!signedIn && under(path, APP_PAGES) && !under(path, PUBLIC_UNDER_APP)) {
    const login = new URL("/login", publicOrigin(req));
    login.searchParams.set("next", `${path}${req.nextUrl.search}`);
    return withHeaders(NextResponse.redirect(login), req);
  }
  return withHeaders(NextResponse.next(), req);
}

export const config = {
  // Not for static files and images (no session or headers needed there).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|woff2?)$).*)"],
};
