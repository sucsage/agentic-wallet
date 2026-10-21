/**
 * The site's own public addresses. Self-hosted behind a proxy or tunnel (e.g. Cloudflare in front of
 * Docker), the server itself sees http://<container> and not the address in the browser, so these
 * come from settings: BETTER_AUTH_URL, APP_ORIGIN and TRUSTED_ORIGINS (comma separated), plus the
 * team's domain.
 */
const DEFAULTS = ["https://www.kravii.com", "https://kravii.com"];

export function siteOrigins(): string[] {
  const list = [process.env.BETTER_AUTH_URL, process.env.APP_ORIGIN, ...(process.env.TRUSTED_ORIGINS ?? "").split(","), ...DEFAULTS];
  const out = new Set<string>();
  for (const raw of list) {
    const v = raw?.trim();
    if (!v) continue;
    try {
      out.add(new URL(v).origin);
    } catch {
      // not an address
    }
  }
  return [...out];
}

/**
 * This site's address as the visitor sees it, for links, redirects and OAuth redirect URIs. Behind a
 * proxy or tunnel the request's own URL is the container's (http://localhost:3000), so APP_ORIGIN (or
 * BETTER_AUTH_URL) wins when set, then the forwarded host; the request URL only without either.
 */
export function publicOrigin(req: Request): string {
  for (const v of [process.env.APP_ORIGIN, process.env.BETTER_AUTH_URL]) {
    try {
      if (v?.trim()) return new URL(v.trim()).origin;
    } catch {
      // not an address
    }
  }
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) return `${req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "http" ? "http" : "https"}://${host}`;
  return new URL(req.url).origin;
}
