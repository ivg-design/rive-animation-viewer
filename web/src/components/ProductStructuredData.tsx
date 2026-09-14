import { getLatestRelease } from "@/lib/github";
import { toCanonicalUrl } from "@/lib/seo";

const siteUrl = toCanonicalUrl("/");

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "RAV - Rive Animation Viewer",
      alternateName: "RAV",
      description:
        "Free desktop player for inspecting, debugging, and testing Rive (.riv) animations.",
      url: siteUrl,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Windows",
      downloadUrl: "https://github.com/ivg-design/rive-animation-viewer/releases/latest",
      installUrl: "https://github.com/ivg-design/rive-animation-viewer/releases/latest",
      screenshot: toCanonicalUrl("/media/screenshots/open-panels_sm.webp"),
      image: toCanonicalUrl("/images/app-icon.png"),
      author: {
        "@type": "Organization",
        name: "IVG Design",
        url: "https://forge.mograph.life",
      },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      license: "https://opensource.org/licenses/MIT",
      isAccessibleForFree: true,
      featureList: [
        "ViewModel list labels from direct authored names or one unique canonical-string match, with ambiguous rows falling back to Row N",
        "One full-width image-source select with every embedded raster, Open file, Clear, hidden external file input, and standalone export parity",
        "Unified Event Console and JavaScript Console with timestamps, search, follow mode, and copy tools",
        "Self-contained HTML demo export that preserves and executes applied editor config and lifecycle callbacks",
        "Snippet and export dialog for selecting exactly which live control values are serialized",
        "Solid or transparent canvas backgrounds, preserved in standalone exports",
        "CodeMirror 6 script editor with live-source indication and APPLY refresh",
        "VM Explorer console commands for deep runtime inspection",
        "Bundled native rav-mcp sidecar with one-click setup for supported AI clients",
        "Developer ID signed and notarized macOS releases with Tauri-authenticated auto updates",
        "Tauri v2 desktop app with official and legacy macOS .riv UTI declarations, dedicated macOS and Windows document icons, upgrade-aware Windows registration, and single-instance forwarding",
        "Canvas and WebGL2 dual renderer with Latest auto-selection, warned 2.40.0 pin, and live semver switching",
        "Overflow-safe auto-margin centering and styled 10px scrollbars for fixed-size central canvases",
        "State preservation across refresh, reload, and export flows",
      ],
    },
    {
      "@type": "Organization",
      name: "IVG Design",
      url: "https://forge.mograph.life",
      sameAs: ["https://github.com/ivg-design"],
    },
  ],
};

export default async function ProductStructuredData() {
  const latestPublicRelease = await getLatestRelease();
  const currentJsonLd = latestPublicRelease ? {
    ...jsonLd,
    "@graph": jsonLd["@graph"].map((entry, index) => index === 0 ? {
      ...entry,
      softwareVersion: latestPublicRelease.version,
      releaseNotes: toCanonicalUrl("/changelog"),
      dateModified: latestPublicRelease.date,
    } : entry),
  } : jsonLd;

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(currentJsonLd).replace(/</g, "\\u003c") }} />;
}
