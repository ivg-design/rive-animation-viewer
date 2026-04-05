import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, BookOpen } from "lucide-react";
import { asset } from "@/lib/config";

export const metadata: Metadata = {
  title: {
    template: "%s | RAV Docs",
    default: "RAV Documentation",
  },
  description: "Complete RAV documentation for Rive Animation Viewer.",
};


export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg-void)]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[var(--bg-void)]/90 backdrop-blur-sm border-b border-[var(--border-dark)]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href={asset("/")}
            className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            <span>Back to RAV</span>
          </Link>
          <div className="flex items-center gap-3">
            <Image
              src={asset("/images/app-icon.png")}
              alt="RAV"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <BookOpen className="w-5 h-5 text-[var(--neon)]" />
            <span className="font-semibold text-[var(--text-white)]">Documentation</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="docs-content">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-[var(--border-dark)]">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link
            href={asset("/")}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg btn-neon text-sm transition-all hover:scale-105"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to RAV
          </Link>
          <a
            href="https://github.com/ivg-design/rive-animation-viewer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--text-muted)] hover:text-[var(--neon)] transition-colors"
          >
            View on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
