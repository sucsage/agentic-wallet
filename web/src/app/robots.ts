import type { MetadataRoute } from "next";

const SITE = process.env.APP_ORIGIN?.trim() || "https://www.kravii.com";

/** Public pages may be indexed; private links, app screens and the API may not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/download", "/explorer"],
      disallow: ["/api/", "/invite/", "/pay/", "/w/", "/deal", "/deals", "/chat", "/profile", "/groups", "/group", "/admin", "/apply", "/login", "/reset-password", "/mock-id/", "/th/", "/cn/"],
    },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
