"use client";

import { useEffect, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import DocsNavigation, { docsSections } from "@/components/docs/DocsNavigation";
import DocsTableOfContents from "@/components/docs/DocsTableOfContents";
import { asset } from "@/lib/config";
import "./docs-reader.css";

export default function DocsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname().replace(/\/+$/, "");
  const current = docsSections.find((section) => pathname.endsWith(`/docs/${section.id}`));
  const index = current ? docsSections.indexOf(current) : -1;
  const previous = index > 0 ? docsSections[index - 1] : null;
  const next = index >= 0 ? docsSections[index + 1] : docsSections[0];

  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  return (
    <div className="docs-reader">
      <a href="#docs-main" className="docs-skip-link">Skip to content</a>
      <header className="docs-topbar">
        <Link href={asset("/")} className="docs-brand" aria-label="RAV home">
          <Image src={asset("/images/app-icon.png")} alt="" width={32} height={32} />
          <span>RAV</span>
          <span className="docs-brand-label">Documentation</span>
        </Link>
        <nav aria-label="RAV website" className="docs-topbar-links">
          <Link href={asset("/")}>Overview</Link>
          <Link href={asset("/docs")} aria-current="true">Docs</Link>
          <a href="https://github.com/ivg-design/rive-animation-viewer" target="_blank" rel="noopener noreferrer">GitHub</a>
        </nav>
      </header>

      <div className="docs-shell">
        <DocsNavigation currentId={current?.id ?? ""} />
        <main id="docs-main" tabIndex={-1} className="docs-article">
          <nav aria-label="Breadcrumb" className="docs-breadcrumb">
            <Link href={asset("/docs")}>Docs</Link>
            <ChevronRight aria-hidden="true" size={12} />
            <span aria-current="page">{current?.title ?? "Overview"}</span>
          </nav>
          <div id="docs-content" className="docs-content">{children}</div>

          <nav className="docs-pagination" aria-label="Previous and next documentation pages">
            {previous ? (
              <Link href={asset(`/docs/${previous.id}`)}>
                <ChevronLeft aria-hidden="true" size={16} />
                <span><small>Previous</small>{previous.title}</span>
              </Link>
            ) : <span />}
            {next && (
              <Link href={asset(`/docs/${next.id}`)} className="docs-next">
                <span><small>Next</small>{next.title}</span>
                <ChevronRight aria-hidden="true" size={16} />
              </Link>
            )}
          </nav>
          <footer className="docs-footer">
            <Link href={asset("/")}>Back to RAV</Link>
            <a href="https://github.com/ivg-design/rive-animation-viewer" target="_blank" rel="noopener noreferrer">View on GitHub</a>
          </footer>
        </main>
        <DocsTableOfContents key={pathname} />
      </div>
    </div>
  );
}
