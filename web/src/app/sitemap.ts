import type { MetadataRoute } from "next";
import { toCanonicalUrl } from "@/lib/seo";

const RELEASE_MODIFIED = new Date("2026-08-27T00:00:00.000Z");
const CHANGELOG_MODIFIED = new Date("2026-08-27T00:00:00.000Z");
const PRIVACY_MODIFIED = new Date("2026-08-27T00:00:00.000Z");

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
    "/docs/configuration",
    "/docs/mcp",
    "/docs/updates",
    "/docs/shortcuts",
    "/docs/troubleshooting",
  ];

  return [
    {
      url: toCanonicalUrl("/"),
      lastModified: RELEASE_MODIFIED,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...documentationRoutes.map((route) => ({
      url: toCanonicalUrl(route),
      lastModified: RELEASE_MODIFIED,
      changeFrequency: "weekly" as const,
      priority: route === "/docs" ? 0.9 : 0.7,
    })),
    {
      url: toCanonicalUrl("/changelog"),
      lastModified: CHANGELOG_MODIFIED,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: toCanonicalUrl("/privacy"),
      lastModified: PRIVACY_MODIFIED,
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
}
