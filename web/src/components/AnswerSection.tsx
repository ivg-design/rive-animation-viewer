"use client";

import ScrollReveal from "./ScrollReveal";

export default function AnswerSection() {
  return (
    <section className="w-full max-w-[900px] px-8 py-24 mx-auto">
      <ScrollReveal>
        <p className="font-mono text-xs tracking-[0.2em] uppercase text-[var(--neon)] mb-6">
          Why this exists
        </p>
        <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold text-[var(--text-white)] leading-[1.15] mb-6">
          Rive files are designed in the browser.
          <br />
          <span className="text-[var(--text-muted)]">Testing them shouldn&apos;t require a web project.</span>
        </h2>
        <p className="text-base text-[var(--text-dim)] leading-relaxed max-w-[640px]">
          RAV connects directly to the Rive runtime, auto-discovers every ViewModel property
          and state machine input, and gives you live controls without scaffolding.
          When the animation is ready, export the exact instantiation code your app needs &mdash;
          or let an AI agent drive the whole workflow through MCP.
        </p>
      </ScrollReveal>
    </section>
  );
}
