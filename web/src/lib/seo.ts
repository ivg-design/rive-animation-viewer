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
      images: [{
        url: toCanonicalUrl("/media/screenshots/hero-rav-window.webp"),
        width: 2200,
        height: 1639,
        alt: "Rive Animation Viewer interface with script editor, animation canvas, properties, and console panels",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description,
      images: [toCanonicalUrl("/media/screenshots/hero-rav-window.webp")],
    },
  };
}
