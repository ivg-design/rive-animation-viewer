import type { Metadata } from "next";

export const CANONICAL_HOST = "https://forge.mograph.life";
export const CANONICAL_BASE_PATH = "/apps/rav";

export function toCanonicalUrl(path = ""): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedPath === "/") {
    return `${CANONICAL_HOST}${CANONICAL_BASE_PATH}/`;
  }
  return `${CANONICAL_HOST}${CANONICAL_BASE_PATH}${normalizedPath}`;
}

/** Article identity must override the homepage metadata inherited from the layout. */
export function documentationMetadata(slug: string, title: string, description: string): Metadata {
  const url = toCanonicalUrl(`/docs/${slug}`);
  const pageTitle = `${title} | RAV Documentation`;
  return {
    title: pageTitle,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: pageTitle,
      description,
      url,
      type: "article",
      siteName: "RAV — Rive Animation Viewer",
      images: [{ url: toCanonicalUrl("/images/app-icon.png"), width: 512, height: 512, alt: "RAV" }],
    },
    twitter: {
      card: "summary",
      title: pageTitle,
      description,
      images: [toCanonicalUrl("/images/app-icon.png")],
    },
  };
}
