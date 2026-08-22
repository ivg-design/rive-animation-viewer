import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/config";
import { toCanonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "RAV Privacy | Anonymous Usage Counts",
  description: "What RAV sends for anonymous installation and monthly-active counts, why, and how to turn it off.",
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
          <p className="font-mono text-xs tracking-[0.2em] uppercase text-[var(--neon)] mb-4">Anonymous usage</p>
          <h1 className="text-4xl font-bold text-[var(--text-white)] mb-4">Small counts, explicit limits</h1>
          <p className="text-lg text-[var(--text-muted)] leading-relaxed">
            Official RAV builds use a default-on, opt-out counter to estimate installations and monthly-active installations. This page describes the complete app payload and how to disable it.
          </p>
        </div>
      </section>

      <section className="py-12 px-6">
        <div className="docs-content mx-auto">
          <h2>Controller and purpose</h2>
          <p>
            IVG Design operates the counter to understand adoption, maintain the free application, and plan compatibility work. These approximate product metrics are not used for advertising, profiles, licensing, or access control.
          </p>

          <h2>What the app sends</h2>
          <ul>
            <li>One random installation token, reported once after the first-run notice completes or is explicitly dismissed unless reporting is disabled first.</li>
            <li>A separately derived random token once per UTC month while RAV is used.</li>
            <li>The RAV release number and, for monthly activity, the UTC month.</li>
          </ul>
          <p>
            RAV does not send animation files, file contents, file names or paths, hardware identifiers, IP addresses in the payload, account information, email addresses, or license data. The public source rejects unknown payload fields.
          </p>

          <h2>Processing and retention</h2>
          <p>
            Cloudflare delivers the request and stores the counter in D1. The Worker inspects content type and length and parses only the bounded, allowlisted JSON payload. It does not persist raw bodies, request metadata, IP addresses, or user agents, although Cloudflare necessarily processes connection metadata to deliver network traffic. Raw random tokens are transformed with a server-side HMAC before storage. Deduplication digests are deleted after 90 days; identifier-free aggregate totals are retained.
          </p>

          <h2>Default-on notice and opt-out</h2>
          <p>
            On the first run of a configured official build, RAV shows a 15-second privacy notice. Reporting remains locked until the notice completes or is explicitly dismissed, then waits another 30 seconds before the first attempt. The timer pauses while the notice is hovered, one of its actions has keyboard focus, or the app is hidden. Closing RAV before completion or explicit dismissal causes it to appear again next launch. Anonymous Usage can be turned off immediately from that notice or at any time in Settings. Turning it off stops later reports and removes pending random tokens and the local monthly secret. A network request already in flight may finish. Turning it off does not delete identifier-free aggregate counts or local deduplication markers for reports already received by the counter endpoint.
          </p>

          <h2>Public website counter</h2>
          <p>
            The RAV website reads only the aggregate installation total. The underlying aggregate changes when a new installation report is accepted. The website checks about once per minute while active and refreshes when revisited; layered caches mean visitors will typically see the update within a few minutes. It represents reported app-data installations, not exact people or physical devices.
          </p>

          <h2>Legal basis and objections</h2>
          <p>
            IVG Design relies on its legitimate interest in measuring adoption of the free application, balanced against the deliberately narrow payload, short digest retention, first-run notice, and immediate opt-out. You may object by turning Anonymous Usage off. Depending on where you live, additional privacy rights may apply.
          </p>
          <p>
            Depending on applicable law, those rights may include access, correction, deletion, restriction, objection, or a complaint to your local data-protection authority. Because RAV sends no account or contact information and retained records are pseudonymous digests or aggregate counts, IVG Design generally cannot connect a server record to a particular person.
          </p>

          <h2>Questions</h2>
          <p>
            Contact IVG Design through the RAV <a href="https://github.com/ivg-design/rive-animation-viewer/issues" target="_blank" rel="noopener noreferrer">public issue tracker</a>. Do not include private animation files or personal information in a public issue.
          </p>

          <p className="text-xs text-[var(--text-ghost)] mt-12">Effective August 22, 2026 · Notice version 1</p>
        </div>
      </section>
    </main>
  );
}
