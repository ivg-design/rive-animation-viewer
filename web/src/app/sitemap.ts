import type { MetadataRoute } from "next";
import { toCanonicalUrl } from "@/lib/seo";

const HOME_MODIFIED = new Date("2026-10-20T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  const documentationRoutes = [
    "/docs",
    "/docs/getting-started",
    "/docs/opening-files",
    "/docs/ui-layout",
    "/docs/viewmodel-controls",
    "/docs/artboard-switcher",
    "/docs/script-editor",
    "/docs/consoles",
    "/docs/export",
    "/docs/media-export",
    "/docs/configuration",
    "/docs/mcp",
    "/docs/updates",
    "/docs/shortcuts",
    "/docs/troubleshooting",
  ];

  return [
    {
      url: toCanonicalUrl("/"),
      lastModified: HOME_MODIFIED,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...documentationRoutes.map((route) => ({
      url: toCanonicalUrl(route),
      changeFrequency: "weekly" as const,
      priority: route === "/docs" ? 0.9 : 0.7,
    })),
    {
      url: toCanonicalUrl("/changelog"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: toCanonicalUrl("/privacy"),
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
}
