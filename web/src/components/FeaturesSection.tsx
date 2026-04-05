"use client";

import Image from "next/image";
import { asset } from "@/lib/config";
import ScrollReveal, { ScrollRevealGroup, ScrollRevealItem } from "./ScrollReveal";
import {
  Gamepad2, Terminal, FileCode, Code2, MonitorCog, RotateCcw,
  Cable, Layers, Download, Maximize, MousePointerClick, Search,
} from "lucide-react";

/* ── Primary features — editorial blocks with screenshots ── */

const primaryFeatures = [
  {
    label: "Controls",
    title: "Every property, live",
    description: "RAV reads the ViewModel hierarchy and state machine inputs from your .riv file and renders native controls — booleans, numbers, strings, enums, colors, and triggers — all synchronized with the running runtime in real time.",
    image: "/docs/vm-controls-panel.webp",
    imageAlt: "ViewModel controls panel showing enums, numbers, booleans, color picker, and nested instances",
    imageWidth: 400,
    imageHeight: 900,
    reverse: false,
  },
  {
    label: "Export",
    title: "From viewer to codebase",
    description: "Choose which controls to serialize, pick CDN or local package output, preview the generated snippet inline, and copy or export a self-contained HTML demo — all from one dialog. Fixed canvas sizes, layout modes, and artboard state carry through.",
    image: "/docs/export-controls.webp",
    imageAlt: "Snippet & Export Controls dialog with tree checkboxes and live code preview",
    imageWidth: 800,
    imageHeight: 500,
    reverse: true,
  },
  {
    label: "MCP",
    title: "AI agents as co-pilots",
    description: "A bundled native sidecar exposes 32 MCP tools. Claude, Codex, or any MCP client can open files, inspect ViewModels, drive playback, edit scripts, generate snippets, and export demos — without touching the UI. One-click install from the app.",
    image: "/docs/mcp-setup.webp",
    imageAlt: "MCP Setup dialog with client detection, one-click install, and snippet copy",
    imageWidth: 500,
    imageHeight: 700,
    reverse: false,
  },
];

/* ── Secondary features — compact grid ── */

const secondaryFeatures = [
  { icon: Layers, title: "Artboard switching", desc: "Switch artboards and playback targets from dropdowns. VM controls repopulate per target." },
  { icon: Terminal, title: "Dual consoles", desc: "Event log and JavaScript REPL with timestamps, follow mode, level filters, and copy." },
  { icon: Code2, title: "Script editor", desc: "CodeMirror 6 with live source indication. Apply config without losing artboard state." },
  { icon: MonitorCog, title: "Renderer + runtime", desc: "Canvas or WebGL2. Latest, pinned, or custom runtime semver. Fit and alignment in the toolbar." },
  { icon: Maximize, title: "Canvas sizing", desc: "Auto or fixed pixel dimensions with aspect lock. Carries through to exports and snippets." },
  { icon: RotateCcw, title: "State preservation", desc: "Reset and reload preserve artboard, playback, and control values across re-instantiation." },
  { icon: Download, title: "Auto updates", desc: "Signed releases detected, downloaded, and installed from the in-app update chip." },
  { icon: Search, title: "VM Explorer", desc: "Inject the helper snippet for vmExplore, vmGet, vmSet, vmTree, and vmPaths debugging." },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="flex flex-col items-center py-24 px-8 w-full">
      {/* Section header */}
      <ScrollReveal className="text-center mb-20 max-w-[600px]">
        <p className="font-mono text-xs tracking-[0.2em] uppercase text-[var(--neon)] mb-4">
          Capabilities
        </p>
        <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold text-[var(--text-white)] leading-[1.15]">
          What RAV does
        </h2>
      </ScrollReveal>

      {/* Primary features — editorial alternating layout */}
      <div className="flex flex-col gap-32 max-w-[1100px] w-full mb-32">
        {primaryFeatures.map((feature) => (
          <ScrollReveal key={feature.title}>
            <div className={`flex flex-col ${feature.reverse ? "md:flex-row-reverse" : "md:flex-row"} items-center gap-12`}>
              {/* Image */}
              <div className="md:w-1/2 flex-shrink-0">
                <div className="relative rounded-xl overflow-hidden border border-[var(--border-dark)] bg-[var(--bg-zinc)]">
                  <Image
                    src={asset(feature.image)}
                    alt={feature.imageAlt}
                    width={feature.imageWidth}
                    height={feature.imageHeight}
                    className="w-full h-auto"
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                </div>
              </div>

              {/* Text */}
              <div className="md:w-1/2">
                <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-[var(--neon)] mb-3">
                  {feature.label}
                </p>
                <h3 className="text-2xl md:text-3xl font-bold text-[var(--text-white)] mb-4 leading-tight">
                  {feature.title}
                </h3>
                <p className="text-[15px] text-[var(--text-dim)] leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </div>
          </ScrollReveal>
        ))}
      </div>

      {/* Secondary features — compact grid */}
      <ScrollRevealGroup className="grid grid-cols-2 md:grid-cols-4 gap-px max-w-[1100px] w-full bg-[var(--border-dark)] rounded-xl overflow-hidden">
        {secondaryFeatures.map((feature) => (
          <ScrollRevealItem key={feature.title}>
            <div className="bg-[var(--bg-void)] p-6 flex flex-col gap-3 h-full hover:bg-[var(--bg-zinc)] transition-colors duration-300">
              <feature.icon className="w-5 h-5 text-[var(--neon)]" />
              <h4 className="text-sm font-semibold text-[var(--text-white)]">{feature.title}</h4>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">{feature.desc}</p>
            </div>
          </ScrollRevealItem>
        ))}
      </ScrollRevealGroup>
    </section>
  );
}
