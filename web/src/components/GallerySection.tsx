"use client";

import { useState } from "react";
import Image from "next/image";
import { asset } from "@/lib/config";
import { X, Play } from "lucide-react";

type GalleryItem = {
  type: "image" | "video";
  src: string;
  fullSrc?: string;
  alt?: string;
  caption: string;
  width: number;
  height: number;
};

const items: GalleryItem[] = [
  {
    type: "video",
    src: "/media/video/demo-1.mp4",
    caption: "App demo",
    width: 2922,
    height: 2140,
  },
  {
    type: "image",
    src: "/media/screenshots/properties-panel_sm.webp",
    fullSrc: "/media/screenshots/properties-panel.png",
    alt: "Properties panel with ViewModel controls",
    caption: "ViewModel controls",
    width: 862,
    height: 1356,
  },
  {
    type: "image",
    src: "/media/screenshots/event-console_sm.webp",
    fullSrc: "/media/screenshots/event-console.png",
    alt: "Event console with multi-source filtering",
    caption: "Event console",
    width: 1356,
    height: 426,
  },
  {
    type: "image",
    src: "/media/screenshots/open-panels_sm.webp",
    fullSrc: "/media/screenshots/open-panels.png",
    alt: "Full three-panel layout with all panels open",
    caption: "Three-panel layout",
    width: 1756,
    height: 1352,
  },
  {
    type: "image",
    src: "/media/screenshots/transparency-mode_sm.webp",
    fullSrc: "/media/screenshots/transparency-mode.png",
    alt: "Transparency overlay mode",
    caption: "Transparency mode",
    width: 1468,
    height: 1118,
  },
  {
    type: "image",
    src: "/media/screenshots/script-editor_sm.webp",
    fullSrc: "/media/screenshots/script-editor.png",
    alt: "CodeMirror script editor panel",
    caption: "Script editor",
    width: 1002,
    height: 1214,
  },
  {
    type: "image",
    src: "/media/screenshots/settings-panel_sm.webp",
    fullSrc: "/media/screenshots/settings-panel.png",
    alt: "Settings panel with renderer and layout options",
    caption: "Settings panel",
    width: 302,
    height: 362,
  },
  {
    type: "image",
    src: "/media/screenshots/collapsed-panels_sm.webp",
    fullSrc: "/media/screenshots/collapsed-panels.png",
    alt: "Minimal view with collapsed panels",
    caption: "Collapsed panels view",
    width: 1756,
    height: 1352,
  },
  {
    type: "video",
    src: "/media/video/demo2.mp4",
    caption: "Feature walkthrough",
    width: 2714,
    height: 1970,
  },
];

function VideoCell({ item, className }: { item: GalleryItem; className?: string }) {
  return (
    <div className={`relative rounded-2xl overflow-hidden bg-[var(--bg-zinc)] border border-[var(--border-dark)] ${className || ""}`}>
      <video
        src={asset(item.src)}
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm flex items-center gap-1.5">
        <Play className="w-3 h-3 text-[var(--neon)]" fill="currentColor" />
        <span className="text-xs text-white/80">{item.caption}</span>
      </div>
    </div>
  );
}

function ImageCell({
  item,
  className,
  onClick,
}: {
  item: GalleryItem;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-2xl overflow-hidden bg-[var(--bg-zinc)] border border-[var(--border-dark)] hover:border-[var(--neon-glow)] transition-all duration-300 cursor-pointer group ${className || ""}`}
    >
      <Image
        src={asset(item.src)}
        alt={item.alt || ""}
        fill
        className="object-cover group-hover:scale-[1.03] transition-transform duration-500"
        sizes="(max-width: 768px) 100vw, 50vw"
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
      <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <span className="text-xs text-white/80">{item.caption}</span>
      </div>
    </button>
  );
}

export default function GallerySection() {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const imageItems = items.filter((i) => i.type === "image");
  const imgIdx = (item: GalleryItem) => imageItems.indexOf(item);

  const [video1, properties, eventConsole, openPanels, transparency, scriptEditor, settings, collapsed, video2] = items;

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

      {/* Bento Grid - manual rows for tight packing */}
      <div className="flex flex-col gap-2 max-w-[1100px] w-full">

        {/* Row 1: Video (4/6) + Properties (2/6) */}
        <div className="md:aspect-[2/1] md:overflow-hidden">
          <div className="flex flex-col md:flex-row gap-2 md:h-full">
            <VideoCell
              item={video1}
              className="aspect-[2922/2140] md:aspect-auto md:flex-[4] md:min-w-0"
            />
            <ImageCell
              item={properties}
              onClick={() => setLightboxIndex(imgIdx(properties))}
              className="aspect-[862/1356] md:aspect-auto md:flex-[2] md:min-w-0"
            />
          </div>
        </div>

        {/* Row 2: Event Console (full width) */}
        <ImageCell
          item={eventConsole}
          onClick={() => setLightboxIndex(imgIdx(eventConsole))}
          className="aspect-[1356/426]"
        />

        {/* Row 3: Open Panels + Transparency (50/50) */}
        <div className="md:aspect-[2.6/1] md:overflow-hidden">
          <div className="flex flex-col md:flex-row gap-2 md:h-full">
            <ImageCell
              item={openPanels}
              onClick={() => setLightboxIndex(imgIdx(openPanels))}
              className="aspect-[1756/1352] md:aspect-auto md:flex-1 md:min-w-0"
            />
            <ImageCell
              item={transparency}
              onClick={() => setLightboxIndex(imgIdx(transparency))}
              className="aspect-[1468/1118] md:aspect-auto md:flex-1 md:min-w-0"
            />
          </div>
        </div>

        {/* Row 4: Script (2/6) + Settings (1/6, self-sized) + Collapsed (3/6) */}
        <div className="md:aspect-[2.5/1] md:overflow-hidden">
          <div className="flex flex-col md:flex-row gap-2 md:h-full md:items-start">
            <ImageCell
              item={scriptEditor}
              onClick={() => setLightboxIndex(imgIdx(scriptEditor))}
              className="aspect-[1002/1214] md:aspect-auto md:flex-[2] md:min-w-0 md:self-stretch"
            />
            <ImageCell
              item={settings}
              onClick={() => setLightboxIndex(imgIdx(settings))}
              className="aspect-[302/362] md:flex-[1] md:min-w-0"
            />
            <ImageCell
              item={collapsed}
              onClick={() => setLightboxIndex(imgIdx(collapsed))}
              className="aspect-[1756/1352] md:aspect-auto md:flex-[3] md:min-w-0 md:self-stretch"
            />
          </div>
        </div>

        {/* Row 5: Video 2 (full width) */}
        <VideoCell
          item={video2}
          className="aspect-[2714/1970]"
        />
      </div>

      {/* Lightbox */}
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
              src={asset(imageItems[lightboxIndex].fullSrc || imageItems[lightboxIndex].src)}
              alt={imageItems[lightboxIndex].alt || ""}
              width={imageItems[lightboxIndex].width * 2}
              height={imageItems[lightboxIndex].height * 2}
              className="max-w-full max-h-full object-contain"
              sizes="90vw"
            />
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-sm">
            <span className="text-sm text-white/80">{imageItems[lightboxIndex].caption}</span>
          </div>
        </div>
      )}
    </section>
  );
}
