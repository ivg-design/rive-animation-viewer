"use client";

import ScrollReveal from "./ScrollReveal";
import { asset } from "@/lib/config";

export default function AnswerSection() {
  return (
    <section className="w-full max-w-[900px] px-8 py-24 mx-auto">
      <ScrollReveal>
        <p className="font-mono text-xs tracking-[0.2em] uppercase text-[var(--neon)] mb-6">
          Why this exists
        </p>
        <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold text-[var(--text-white)] leading-[1.15] mb-6">
          A Rive file viewer for your desktop.
          <br />
          <span className="text-[var(--text-muted)]">Testing them shouldn&apos;t require a web project.</span>
        </h2>
        <p className="text-base text-[var(--text-dim)] leading-relaxed max-w-[640px]">
          RAV is a free, open-source .riv viewer and player for macOS and Windows.
          It connects directly to the Rive runtime, discovers ViewModel properties
          and keeps state-machine playback available, and gives you live controls without scaffolding.
          When the animation is ready, export the exact instantiation code your app needs &mdash;
          or let an AI agent drive the whole workflow through MCP.
        </p>
        <p className="text-base text-[var(--text-dim)] leading-relaxed max-w-[640px] mt-5">
          Use the Rive editor to create the original artwork and animation; use RAV
          to inspect the exported <code>.riv</code> and test its behavior before integration.
          Rive source projects (<code>.rev</code>) need a runtime export first.
        </p>
        <nav aria-label="Start using RAV" className="flex flex-wrap gap-x-6 gap-y-3 mt-6 text-sm text-[var(--neon)] underline underline-offset-4">
          <a href={asset("/docs/getting-started")}>Open and preview a .riv file</a>
          <a href={asset("/docs/viewmodel-controls")}>Test ViewModel controls</a>
          <a href={asset("/docs/export")}>Export an interactive demo</a>
        </nav>
      </ScrollReveal>
    </section>
  );
}
