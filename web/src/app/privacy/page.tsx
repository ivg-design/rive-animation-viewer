import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/config";
import { toCanonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "RAV Privacy Policy",
  description: "RAV anonymous version reporting and how to turn it off.",
  alternates: { canonical: toCanonicalUrl("/privacy") },
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--bg-void)]">
      <header className="sticky top-0 z-40 bg-[var(--bg-void)]/90 backdrop-blur-sm border-b border-[var(--border-dark)]">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href={asset("/")} className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-white)]">
            <ChevronLeft className="w-5 h-5" />
            <span>Back to RAV</span>
          </Link>
          <div className="flex items-center gap-3">
            <Image src={asset("/images/app-icon.png")} alt="RAV" width={32} height={32} className="rounded-lg" />
            <span className="font-semibold text-[var(--text-white)]">Privacy</span>
          </div>
        </div>
      </header>

      <section className="py-16 px-6 border-b border-[var(--border-dark)]">
        <div className="max-w-3xl mx-auto">
          <p className="font-mono text-xs tracking-[0.2em] uppercase text-[var(--neon)] mb-4">RAV</p>
          <h1 className="text-4xl font-bold text-[var(--text-white)] mb-4">Privacy Policy</h1>
          <p className="text-lg text-[var(--text-muted)] leading-relaxed">
            RAV keeps usage reporting small and anonymous.
          </p>
        </div>
      </section>

      <section className="py-12 px-6">
        <div className="docs-content mx-auto">
          <h2>Anonymous Usage</h2>
          <p>Official RAV releases send an anonymous notice of the installed RAV version.</p>
          <p>RAV does not send your Rive files or personal information.</p>
          <p>You can turn Anonymous Usage off at any time in RAV Settings.</p>
          <p className="text-xs text-[var(--text-ghost)] mt-12">Effective August 22, 2026</p>
        </div>
      </section>
    </main>
  );
}
