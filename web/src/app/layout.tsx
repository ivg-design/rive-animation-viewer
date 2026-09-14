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
  title: "Rive Animation Viewer (RAV) — Free .riv Player",
  description:
    "Open and inspect .riv files on macOS and Windows. Test ViewModels, debug events, and export interactive HTML demos with free, open-source RAV.",
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
    title: "Rive Animation Viewer (RAV) — Free .riv Player",
    description:
      "Open and inspect .riv files on macOS and Windows. Test ViewModels, debug events, and export interactive HTML demos with free, open-source RAV.",
    type: "website",
    url: siteUrl,
    siteName: "Rive Animation Viewer (RAV) — Free .riv Player",
    images: [
      {
        url: toCanonicalUrl("/images/app-icon.png"),
        width: 512,
        height: 512,
        alt: "Rive Animation Viewer (RAV) — Free .riv Player icon",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rive Animation Viewer (RAV) — Free .riv Player",
    description: "Open and inspect .riv files on macOS and Windows. Test ViewModels, debug events, and export interactive HTML demos with free, open-source RAV.",
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
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
