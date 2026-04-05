import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, Sparkles, Bug, Wrench } from "lucide-react";
import { asset } from "@/lib/config";
import { parseChangelog } from "@/lib/changelog";
import { toCanonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "RAV Changelog | Release Notes",
  description: "Version-by-version release notes for Rive Animation Viewer (RAV).",
  alternates: {
    canonical: toCanonicalUrl("/changelog"),
  },
};

function CategorySection({
  icon: Icon,
  title,
  items,
  color,
}: {
  icon: typeof Sparkles;
  title: string;
  items: string[];
  color: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-6 last:mb-0">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className={`text-sm font-medium ${color}`}>{title}</span>
      </div>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-3 text-sm text-[var(--text-dim)]">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${color.replace('text-', 'bg-')}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VersionSidebar({ versions }: { versions: string[] }) {
  return (
    <nav className="hidden lg:block fixed left-8 top-1/2 -translate-y-1/2 z-30">
      <div className="flex flex-col gap-1 p-3 rounded-xl bg-[var(--bg-zinc)]/80 backdrop-blur-sm border border-[var(--border-light)] max-h-[70vh] overflow-y-auto">
        <span className="text-[10px] font-medium text-[var(--text-ghost)] uppercase tracking-wider px-2 mb-1">
          Versions
        </span>
        {versions.map((version, index) => (
          <a
            key={version}
            href={`#v${version}`}
            className={`px-3 py-1.5 rounded-lg text-sm font-mono transition-all duration-200 ${
              index === 0
                ? 'bg-[var(--neon-dim)] text-[var(--neon)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-white)] hover:bg-[var(--bg-void)]'
            }`}
          >
            v{version}
          </a>
        ))}
      </div>
    </nav>
  );
}

export default function ChangelogPage() {
  const entries = parseChangelog();
  const versionList = entries.map(e => e.version);

  return (
    <main className="min-h-screen bg-[var(--bg-void)]">
      <VersionSidebar versions={versionList} />

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
            <span className="font-semibold text-[var(--text-white)]">Changelog</span>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 px-6 border-b border-[var(--border-dark)]">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-[var(--text-white)] mb-4">
            Changelog
          </h1>
          <p className="text-lg text-[var(--text-muted)] max-w-2xl mx-auto">
            All notable changes to Rive Animation Viewer, from v1.0.0 to the latest release.
          </p>
        </div>
      </section>

      {/* Entries */}
      <section className="py-12 px-6">
        <div className="max-w-4xl mx-auto">
          {entries.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[var(--text-muted)] mb-4">No changelog entries found.</p>
            </div>
          ) : (
            <div className="space-y-12">
              {entries.map((entry, index) => {
                const hasContent = entry.added.length > 0 || entry.fixed.length > 0 || entry.changed.length > 0;
                return (
                  <div
                    key={entry.version}
                    id={`v${entry.version}`}
                    className={`relative pl-8 scroll-mt-24 ${
                      index !== entries.length - 1 ? 'pb-12 border-l border-[var(--border-dark)]' : ''
                    }`}
                  >
                    <div className={`absolute left-0 -translate-x-1/2 w-4 h-4 rounded-full border-4 border-[var(--bg-void)] ${
                      index === 0 ? 'bg-[var(--neon)]' : 'bg-[var(--border-light)]'
                    }`} />

                    <div className="mb-6">
                      <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-2xl font-bold font-mono text-[var(--text-white)]">
                          v{entry.version}
                        </h2>
                        {index === 0 && (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-[var(--neon-dim)] text-[var(--neon)]">
                            Latest
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-[var(--text-ghost)]">
                        {new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>

                    {hasContent && (
                      <div className="p-6 rounded-xl bg-[var(--bg-zinc)] border border-[var(--border-dark)]">
                        <CategorySection icon={Sparkles} title="Added" items={entry.added} color="text-green-400" />
                        <CategorySection icon={Wrench} title="Changed" items={entry.changed} color="text-amber-400" />
                        <CategorySection icon={Bug} title="Fixed" items={entry.fixed} color="text-blue-400" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-[var(--border-dark)]">
        <div className="max-w-4xl mx-auto text-center">
          <Link
            href={asset("/")}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg btn-neon text-sm transition-all hover:scale-105"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to RAV
          </Link>
        </div>
      </footer>
    </main>
  );
}
