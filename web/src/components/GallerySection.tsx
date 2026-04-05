"use client";

import { useState } from "react";
import Image from "next/image";
import { asset } from "@/lib/config";
import { X } from "lucide-react";

type GalleryItem = {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
};

const items: GalleryItem[] = [
  {
    src: "/docs/ui-overview.webp",
    alt: "Full RAV application layout with editor, canvas, properties panel, and console",
    caption: "Application overview",
    width: 1280,
    height: 800,
  },
  {
    src: "/docs/vm-controls-panel.webp",
    alt: "Properties panel showing ViewModel controls, state machine inputs, and nested instances",
    caption: "ViewModel controls",
    width: 400,
    height: 900,
  },
  {
    src: "/docs/event-console.webp",
    alt: "Event console with multi-source filtering and timestamps",
    caption: "Event console",
    width: 800,
    height: 200,
  },
  {
    src: "/docs/js-console.webp",
    alt: "JavaScript console REPL with object introspection and level filters",
    caption: "JavaScript console",
    width: 800,
    height: 200,
  },
  {
    src: "/docs/export-controls.webp",
    alt: "Snippet and Export Controls dialog with tree checkboxes and code preview",
    caption: "Export controls",
    width: 800,
    height: 500,
  },
  {
    src: "/docs/artboard-switcher.webp",
    alt: "Artboard switcher with playback dropdown and VM instance selector",
    caption: "Artboard switcher",
    width: 400,
    height: 250,
  },
  {
    src: "/docs/mcp-setup.webp",
    alt: "MCP Setup dialog with client detection and install actions",
    caption: "MCP setup",
    width: 500,
    height: 700,
  },
  {
    src: "/docs/settings-popover.webp",
    alt: "Settings panel with runtime version, canvas sizing, and background controls",
    caption: "Settings panel",
    width: 500,
    height: 320,
  },
  {
    src: "/docs/about-window.webp",
    alt: "About window with build matrix, credits, and dependency inventory",
    caption: "About window",
    width: 600,
    height: 400,
  },
];

export default function GallerySection() {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <section id="screenshots" className="flex flex-col items-center gap-12 py-24 px-8 section-gradient w-full">
      <div className="flex flex-col items-center gap-4">
        <span className="font-mono text-xs font-medium tracking-[3px] uppercase text-[var(--neon)]">
          Screenshots
        </span>
        <h2 className="font-sans font-bold text-4xl text-[var(--text-white)]">
          See it in action
        </h2>
      </div>

      <div className="columns-1 sm:columns-2 lg:columns-3 gap-3 max-w-[1100px] w-full">
        {items.map((item, index) => (
          <button
            key={item.caption}
            onClick={() => setLightboxIndex(index)}
            className="group relative w-full mb-3 break-inside-avoid rounded-xl overflow-hidden bg-[var(--bg-zinc)] border border-[var(--border-dark)] hover:border-[var(--neon-glow)] transition-colors duration-300 cursor-pointer block"
          >
            <Image
              src={asset(item.src)}
              alt={item.alt}
              width={item.width}
              height={item.height}
              className="w-full h-auto group-hover:scale-[1.02] transition-transform duration-500"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
            <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <span className="text-[10px] text-white/80">{item.caption}</span>
            </div>
          </button>
        ))}
      </div>

      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-6 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <div className="relative w-[90vw] h-[85vh] flex items-center justify-center">
            <Image
              src={asset(items[lightboxIndex].src)}
              alt={items[lightboxIndex].alt}
              width={items[lightboxIndex].width * 2}
              height={items[lightboxIndex].height * 2}
              className="max-w-full max-h-full object-contain"
              sizes="90vw"
            />
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-sm">
            <span className="text-sm text-white/80">{items[lightboxIndex].caption}</span>
          </div>
        </div>
      )}
    </section>
  );
}
