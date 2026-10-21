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
