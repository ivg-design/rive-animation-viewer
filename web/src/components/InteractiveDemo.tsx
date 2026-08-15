"use client";

import Image from "next/image";
import { useState } from "react";
import { asset } from "@/lib/config";

// Coordinates measured against the 1690 × 1260 hero image. Window itself sits inside
// 80pt margins; layout segments documented at the source measurement pass.
const hotspots = [
  {
    id: "title-bar",
    label: "Title Bar",
    description: "Custom window chrome with the RAV brand. Minimize, maximize, and close controls on the right.",
    top: "6.349%", left: "4.734%", width: "90.178%", height: "3.968%",
  },
  {
    id: "open-btn",
    label: "Open",
    description: "Load any .riv file from disk. Drag-and-drop onto the canvas works too.",
    top: "10.317%", left: "4.734%", width: "16.450%", height: "4.762%",
  },
  {
    id: "toolbar",
    label: "Toolbar",
    description: "Reset, play, pause, renderer (WebGL2 / Canvas), layout fit (contain / cover / fill / scaleDown / fitWidth / fitHeight / none / layout), alignment, and live FPS — all in one row.",
    top: "10.317%", left: "23.817%", width: "52.012%", height: "4.603%",
  },
  {
    id: "export-btn",
    label: "Export & Settings",
    description: "EXPORT generates self-contained HTML demos and copy-paste instantiation snippets with per-control selection. The neighbouring icons cover settings and MCP setup.",
    top: "10.317%", left: "78.698%", width: "16.213%", height: "4.127%",
  },
  {
    id: "editor",
    label: "Script Editor",
    description: "CodeMirror panel for the Rive instantiation config — autoplay, autoBind, artboard, stateMachines, layout, canvasSize, and lifecycle callbacks. Press APPLY to re-instantiate the runtime. Live build / runtime info anchored at the bottom.",
    top: "15.079%", left: "4.734%", width: "18.817%", height: "77.619%",
  },
  {
    id: "canvas",
    label: "Canvas",
    description: "The animation viewport. Drop a .riv file here or hit OPEN. Renders via WebGL2 by default; switch renderer in the toolbar. Auto margins center fixed canvases and collapse safely for authored-origin scrolling.",
    top: "15.079%", left: "23.817%", width: "51.893%", height: "55.873%",
  },
  {
    id: "runtime-info",
    label: "Runtime Strip",
    description: "MCP bridge health and recent-command activity, console toggle, runtime version label, and a structured status that restores after transient notices like canvas-size or runtime changes.",
    top: "70.952%", left: "23.817%", width: "51.893%", height: "3.175%",
  },
  {
    id: "console",
    label: "Console Panel",
    description: "Two modes — Events log and JS REPL — sharing the bottom panel. Filter Events by source (NATIVE / RIVE USER / UI / MCP), filter JS by level, search either, follow latest, copy visible rows. All four filter toggles are also drivable from MCP.",
    top: "74.127%", left: "23.817%", width: "51.893%", height: "17.937%",
  },
  {
    id: "properties",
    label: "Properties",
    description: "Auto-discovered ViewModel controls and state machine inputs. List rows resolve authored labels; each image property uses one full-width select with embedded rasters, Open file…, and Clear.",
    top: "15.079%", left: "75.976%", width: "18.935%", height: "77.619%",
  },
];

// When a hotspot's bottom is past 60% of the image, anchor the tooltip ABOVE
// the hotspot (so it doesn't fall off the bottom of the page). Otherwise anchor
// below (default). When a hotspot's right edge is past 65%, right-align the
// tooltip so it doesn't overflow horizontally.
function tooltipPosition(spot: typeof hotspots[number]) {
  const top = parseFloat(spot.top);
  const height = parseFloat(spot.height);
  const left = parseFloat(spot.left);
  const width = parseFloat(spot.width);

  const bottom = top + height;
  const right = left + width;

  const placeAbove = bottom > 78;
  const alignRight = right > 65;

  return {
    style: placeAbove
      ? { bottom: `calc(100% - ${spot.top} + 8px)`, ...(alignRight ? { right: `${100 - right}%` } : { left: spot.left }) }
      : { top: `calc(${spot.top} + ${spot.height} + 8px)`, ...(alignRight ? { right: `${100 - right}%` } : { left: spot.left }) },
    alignRight,
  };
}

export default function InteractiveDemo() {
  const [activeHotspot, setActiveHotspot] = useState<string | null>(null);
  const active = hotspots.find((h) => h.id === activeHotspot);

  return (
    <div className="relative w-full max-w-[1100px] mx-auto">
      {/* Aspect-matched outer frame; overlays live here so tooltips can escape image clipping */}
      <div className="relative aspect-[169/126]">
        {/* Image clip container — only the image is clipped, NOT the overlays */}
        <div className="absolute inset-0 rounded-xl overflow-hidden border border-[var(--border-light)] shadow-2xl shadow-black/60">
          <Image
            src={asset("/media/screenshots/hero-rav-window.webp")}
            alt="Rive Animation Viewer — script editor on the left, canvas centre, properties on the right, console panel along the bottom"
            fill
            priority
            sizes="(max-width: 1100px) 100vw, 1100px"
            className="object-cover"
          />
          {/* Bottom fade — clipped with the image */}
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[var(--bg-void)] to-transparent pointer-events-none" />
        </div>

        {/* Hotspot layer — outside the clip, so highlights and tooltips can extend past the rounded corners if needed */}
        <div className="absolute inset-0 z-10">
          {hotspots.map((spot) => (
            <div
              key={spot.id}
              className={`absolute cursor-pointer transition-all duration-200 rounded-md ${
                activeHotspot === spot.id
                  ? "bg-[var(--neon)]/10 ring-1 ring-[var(--neon)]/40"
                  : "hover:bg-[var(--neon)]/5"
              }`}
              style={{
                top: spot.top,
                left: spot.left,
                width: spot.width,
                height: spot.height,
              }}
              onMouseEnter={() => setActiveHotspot(spot.id)}
              onMouseLeave={() => setActiveHotspot(null)}
            />
          ))}
        </div>

        {/* Tooltip — outside the clip, anchored above/below + left/right depending on hotspot position */}
        {active && (() => {
          const { style } = tooltipPosition(active);
          return (
            <div
              className="absolute z-20 pointer-events-none animate-[fadeIn_150ms_ease-out]"
              style={{ ...style, maxWidth: "320px" }}
            >
              <div className="p-3 rounded-lg bg-[var(--bg-zinc)]/95 backdrop-blur-sm border border-[var(--neon)]/30 shadow-xl shadow-black/50">
                <p className="text-xs font-semibold text-[var(--neon)] mb-1 font-mono tracking-wider uppercase">
                  {active.label}
                </p>
                <p className="text-[13px] text-[var(--text-dim)] leading-relaxed">
                  {active.description}
                </p>
              </div>
            </div>
          );
        })()}
      </div>

      <p className="text-center text-[11px] text-[var(--text-ghost)] mt-3 font-mono">
        Hover over any region to explore the interface
      </p>
    </div>
  );
}
