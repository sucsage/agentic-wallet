import type { MetadataRoute } from "next";

const SITE = process.env.APP_ORIGIN?.trim() || "https://www.kravii.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/download`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE}/explorer`, changeFrequency: "daily", priority: 0.5 },
  ];
}
