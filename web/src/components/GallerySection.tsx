"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { asset } from "@/lib/config";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import ScrollReveal from "./ScrollReveal";

type GalleryItem = {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
};

const items: GalleryItem[] = [
  {
    src: "/docs/event-console.webp",
    alt: "Event console with multi-source filtering",
    caption: "Event console — filter by Native, Rive User, UI, and MCP sources",
    width: 800, height: 200,
  },
  {
    src: "/docs/js-console.webp",
    alt: "JavaScript REPL with object introspection",
    caption: "JavaScript console — REPL against the live runtime with object expansion",
    width: 800, height: 200,
  },
  {
    src: "/docs/artboard-switcher.webp",
    alt: "Artboard switcher with playback and instance dropdowns",
    caption: "Artboard switcher — select artboards, playback targets, and VM instances",
    width: 400, height: 250,
  },
  {
    src: "/docs/settings-popover.webp",
    alt: "Settings panel with runtime version and canvas sizing",
    caption: "Settings — runtime version, canvas sizing, background controls",
    width: 500, height: 320,
  },
  {
    src: "/docs/mcp-setup.webp",
    alt: "MCP setup dialog with bundled sidecar controls and client detection",
    caption: "MCP setup — bridge health, Script Access, port, client detection, and install actions",
    width: 500, height: 700,
  },
  {
    src: "/docs/about-window.webp",
    alt: "About window with build metadata",
    caption: "About — build matrix, credits, dependencies, and product links",
    width: 600, height: 400,
  },
];

export default function GallerySection() {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const goNext = useCallback(() => {
    if (lightboxIndex !== null) setLightboxIndex((lightboxIndex + 1) % items.length);
  }, [lightboxIndex]);
  const goPrev = useCallback(() => {
    if (lightboxIndex !== null) setLightboxIndex((lightboxIndex - 1 + items.length) % items.length);
  }, [lightboxIndex]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, goNext, goPrev]);

  return (
    <section id="screenshots" className="flex flex-col items-center py-24 px-8 w-full">
      <ScrollReveal className="text-center mb-16">
        <p className="font-mono text-xs tracking-[0.2em] uppercase text-[var(--neon)] mb-4">
          Interface
        </p>
        <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold text-[var(--text-white)] leading-[1.15]">
          More of the app
        </h2>
      </ScrollReveal>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-[1100px] w-full">
        {items.map((item, index) => (
          <ScrollReveal key={item.caption} delay={index * 0.05}>
            <button
              onClick={() => setLightboxIndex(index)}
              className="group relative w-full rounded-xl overflow-hidden bg-[var(--bg-zinc)] border border-[var(--border-dark)] hover:border-[var(--neon-glow)] transition-colors duration-300 cursor-pointer text-left"
            >
              <Image
                src={asset(item.src)}
                alt={item.alt}
                width={item.width}
                height={item.height}
                className="w-full h-auto"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
              <div className="p-3 border-t border-[var(--border-dark)]">
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{item.caption}</p>
              </div>
            </button>
          </ScrollReveal>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxIndex(null)}
        >
          <button onClick={() => setLightboxIndex(null)} className="absolute top-6 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10">
            <X className="w-5 h-5 text-white" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); goPrev(); }} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); goNext(); }} className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10">
            <ChevronRight className="w-5 h-5 text-white" />
          </button>
          <div className="relative w-[90vw] h-[85vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <Image
              src={asset(items[lightboxIndex].src)}
              alt={items[lightboxIndex].alt}
              width={items[lightboxIndex].width * 2}
              height={items[lightboxIndex].height * 2}
              className="max-w-full max-h-full object-contain"
              sizes="90vw"
            />
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-black/60 backdrop-blur-sm max-w-[600px] text-center">
            <span className="text-xs text-white/80">{items[lightboxIndex].caption}</span>
          </div>
        </div>
      )}
    </section>
  );
}
