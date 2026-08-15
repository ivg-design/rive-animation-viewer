"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronLeft, BookOpen, ChevronRight } from "lucide-react";
import { asset } from "@/lib/config";

const sections = [
  { id: "getting-started", title: "Getting Started" },
  { id: "opening-files", title: "Opening Files" },
  { id: "ui-layout", title: "UI Layout" },
  { id: "viewmodel-controls", title: "ViewModel Controls" },
  { id: "artboard-switcher", title: "Artboard Switcher" },
  { id: "script-editor", title: "Script Editor" },
  { id: "consoles", title: "Consoles" },
  { id: "export", title: "Export + Snippets" },
  { id: "configuration", title: "Configuration" },
  { id: "mcp", title: "MCP Integration" },
  { id: "updates", title: "Auto Updates" },
  { id: "shortcuts", title: "Shortcuts" },
  { id: "troubleshooting", title: "Troubleshooting" },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const currentSection = sections.find((s) => pathname?.endsWith(`/docs/${s.id}`));
  const isLanding = !currentSection;

  return (
    <div className="min-h-screen bg-[var(--bg-void)]">
      {/* Sticky header with breadcrumb + inline TOC */}
      <header className="sticky top-0 z-40 bg-[var(--bg-void)]/90 backdrop-blur-sm border-b border-[var(--border-dark)]">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Link
              href={asset("/")}
              className="text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors"
            >
              RAV
            </Link>
            <ChevronRight className="w-3 h-3 text-[var(--text-ghost)]" />
            <Link
              href={asset("/docs")}
              className={`transition-colors ${isLanding ? "text-[var(--text-white)] font-semibold" : "text-[var(--text-muted)] hover:text-[var(--text-white)]"}`}
            >
              Docs
            </Link>
            {currentSection && (
              <>
                <ChevronRight className="w-3 h-3 text-[var(--text-ghost)]" />
                <span className="text-[var(--text-white)] font-semibold">{currentSection.title}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Image
              src={asset("/images/app-icon.png")}
              alt="RAV"
              width={24}
              height={24}
              className="rounded-md"
            />
            <BookOpen className="w-4 h-4 text-[var(--neon)]" />
          </div>
        </div>

        {/* Inline scrollable TOC — only on sub-pages */}
        {!isLanding && (
          <div className="border-t border-[var(--border-dark)] overflow-x-auto scrollbar-none">
            <div className="max-w-5xl mx-auto px-6 flex items-center gap-1 py-1.5">
              {sections.map((section) => (
                <Link
                  key={section.id}
                  href={asset(`/docs/${section.id}`)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    currentSection?.id === section.id
                      ? "bg-[var(--neon-dim)] text-[var(--neon)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-white)] hover:bg-[var(--bg-elevated)]"
                  }`}
                >
                  {section.title}
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-16 md:py-20">
        <div className="mb-8 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-[var(--text-dim)]">
          <strong className="text-amber-300">2.4.3 private acceptance candidate.</strong>{" "}
          This documentation describes the signed candidate under test; it is not a public
          release and does not advance the public <code>latest.json</code> feed. Isolated
          signed-updater acceptance and installed-app Launch Services/Finder verification are
          separate remaining gates.
        </div>
        <div className="docs-content">
          {children}
        </div>

        {/* Prev / Next navigation */}
        {currentSection && (() => {
          const idx = sections.findIndex((s) => s.id === currentSection.id);
          const prev = idx > 0 ? sections[idx - 1] : null;
          const next = idx < sections.length - 1 ? sections[idx + 1] : null;
          return (
            <div className="flex items-center justify-between mt-16 pt-8 border-t border-[var(--border-dark)]">
              {prev ? (
                <Link href={asset(`/docs/${prev.id}`)} className="group flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors">
                  <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                  <span>{prev.title}</span>
                </Link>
              ) : <span />}
              {next ? (
                <Link href={asset(`/docs/${next.id}`)} className="group flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors">
                  <span>{next.title}</span>
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              ) : <span />}
            </div>
          );
        })()}
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
