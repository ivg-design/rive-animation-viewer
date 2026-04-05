import type { Metadata } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import WebVitalsReporter from "@/components/WebVitalsReporter";
import { CANONICAL_HOST, toCanonicalUrl } from "@/lib/seo";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const siteUrl = toCanonicalUrl("/");
const faviconPath =
  process.env.NODE_ENV === "production" ? "/apps/rav/images/app-icon.png" : "/images/app-icon.png";

export const metadata: Metadata = {
  title: "RAV - Rive Animation Viewer",
  description:
    "Free desktop player for inspecting, debugging, and testing Rive (.riv) animations offline. ViewModel controls, unified consoles, MCP integration, auto updates, runtime version selection, and self-contained HTML demo export.",
  keywords: [
    "rive",
    "animation",
    "viewer",
    "inspector",
    "debugger",
    "desktop",
    "tauri",
    "macos",
    "windows",
    "riv",
    "rive viewer",
    "rive player",
    "rive desktop",
    "rive animation viewer",
    "riv file viewer",
    "rive debug",
    "viewmodel",
  ],
  authors: [{ name: "IVG Design" }],
  creator: "IVG Design",
  publisher: "IVG Design",
  metadataBase: new URL(CANONICAL_HOST),
  alternates: {
    canonical: toCanonicalUrl("/"),
  },
  icons: {
    icon: faviconPath,
  },
  openGraph: {
    title: "RAV - Rive Animation Viewer",
    description:
      "Free desktop player for inspecting and debugging Rive animations. ViewModel controls, unified consoles, MCP integration, auto updates, and standalone export.",
    type: "website",
    url: siteUrl,
    siteName: "RAV - Rive Animation Viewer",
    images: [
      {
        url: toCanonicalUrl("/images/app-icon.png"),
        width: 512,
        height: 512,
        alt: "RAV - Rive Animation Viewer icon",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "RAV - Rive Animation Viewer",
    description: "Free desktop player for inspecting and debugging Rive animations offline with unified consoles, MCP, and standalone export.",
    images: [toCanonicalUrl("/images/app-icon.png")],
  },
  robots: {
    index: true,
    follow: true,
    "max-snippet": -1,
    "max-image-preview": "large" as const,
    "max-video-preview": -1,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "RAV - Rive Animation Viewer",
      alternateName: "RAV",
      description:
        "Free desktop player for inspecting, debugging, and testing Rive (.riv) animations offline. ViewModel controls, unified consoles, MCP integration, auto updates, runtime version selection, and self-contained HTML demo export.",
      url: siteUrl,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Windows",
      softwareVersion: "2.2.2",
      datePublished: "2025-11-01",
      dateModified: "2026-04-05",
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
        "ViewModel controls with auto-discovered booleans, numbers, strings, enums, colors, and triggers",
        "Unified Event Console and JavaScript Console with timestamps, search, follow mode, and copy tools",
        "Self-contained HTML demo export plus canonical CDN/local instantiation snippets",
        "Snippet and export dialog for selecting exactly which live control values are serialized",
        "Transparency overlay mode with cursor-synced desktop click-through",
        "CodeMirror 6 script editor with live-source indication and APPLY refresh",
        "VM Explorer console commands for deep runtime inspection",
        "Bundled native rav-mcp sidecar with one-click setup for supported AI clients",
        "Desktop updater with signed releases and in-app install/relaunch",
        "Tauri v2 desktop app with .riv file association and single-instance forwarding",
        "Canvas and WebGL2 dual renderer with live semver/runtime switching",
        "State preservation across refresh, reload, and export flows",
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "What is RAV - Rive Animation Viewer?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "RAV is a free, open-source desktop application for inspecting, debugging, and testing Rive (.riv) animation files offline. It provides ViewModel controls, unified event and JavaScript consoles, MCP integration, transparency overlay mode, and self-contained HTML/snippet export. It runs on macOS (Apple Silicon and Intel) and Windows.",
          },
        },
        {
          "@type": "Question",
          name: "Is there a desktop viewer for Rive animations?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. RAV (Rive Animation Viewer) is the only standalone desktop player for Rive animations. It reads .riv files and generates interactive ViewModel controls, logs runtime events, supports transparency overlay, and can export self-contained HTML demos. No equivalent tool exists from Rive or any third party.",
          },
        },
        {
          "@type": "Question",
          name: "How do I debug a Rive animation file?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Open your .riv file in RAV. It auto-discovers all ViewModel inputs and generates interactive controls. The Event Console shows Native, Rive User, UI, and MCP activity in real time, and the JavaScript Console provides a live REPL. The VM Explorer exposes vmExplore, vmGet, vmSet, vmTree, and vmPaths for deep runtime inspection.",
          },
        },
        {
          "@type": "Question",
          name: "Can I export a Rive animation as a standalone HTML file?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. RAV's export flow creates a self-contained HTML file with the .riv animation embedded, the selected runtime package and semver, the current live layout state, selected control values, and a copyable canonical web-instantiation snippet.",
          },
        },
        {
          "@type": "Question",
          name: "What platforms does RAV support?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "RAV provides native desktop apps for macOS Apple Silicon (M-series), macOS Intel, and Windows (64-bit). It can also run in a browser via the local development server. The desktop app supports .riv file association so you can double-click .riv files to open them directly.",
          },
        },
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${spaceMono.variable} h-full font-sans antialiased`}
        suppressHydrationWarning
      >
        {children}
        <WebVitalsReporter />
      </body>
    </html>
  );
}
