import type { MetadataRoute } from "next";
import { toCanonicalUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: toCanonicalUrl("/"),
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: toCanonicalUrl("/docs"),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: toCanonicalUrl("/changelog"),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];
}
