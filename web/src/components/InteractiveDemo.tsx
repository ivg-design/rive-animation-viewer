"use client";

import { useState } from "react";

const hotspots = [
  {
    id: "toolbar",
    label: "Toolbar",
    description: "Playback controls, renderer, fit mode, alignment, and FPS — all in one row.",
    // Positioned over the toolbar area (percentages of iframe)
    top: "5.5%", left: "25%", width: "50%", height: "5%",
  },
  {
    id: "editor",
    label: "Script Editor",
    description: "Write JavaScript config objects to control artboard, state machines, callbacks, and canvas sizing. Apply to re-instantiate the runtime.",
    top: "12%", left: "0%", width: "24%", height: "68%",
  },
  {
    id: "canvas",
    label: "Canvas",
    description: "The animation viewport. Drop a .riv file here or use the OPEN button. Supports WebGL2 and Canvas renderers.",
    top: "12%", left: "24%", width: "52%", height: "60%",
  },
  {
    id: "properties",
    label: "Properties",
    description: "Auto-discovered ViewModel controls and state machine inputs. Switch artboards, select VM instances, and reset to defaults.",
    top: "12%", left: "76%", width: "24%", height: "68%",
  },
  {
    id: "console",
    label: "Console",
    description: "Event log or JavaScript REPL. Filter by source, search, follow latest entries, and copy the visible transcript.",
    top: "73%", left: "0%", width: "76%", height: "20%",
  },
  {
    id: "runtime-strip",
    label: "Runtime Strip",
    description: "MCP status, console toggle, runtime version, loaded file, and auto-update indicator.",
    top: "93%", left: "0%", width: "100%", height: "4%",
  },
  {
    id: "open-btn",
    label: "Open",
    description: "Load any .riv file from disk. Also supports drag-and-drop onto the canvas.",
    top: "5.5%", left: "5%", width: "8%", height: "5%",
  },
  {
    id: "export-btn",
    label: "Export",
    description: "Generate standalone HTML demos and copy-paste instantiation snippets with per-control selection.",
    top: "5.5%", left: "80%", width: "9%", height: "5%",
  },
];

export default function InteractiveDemo() {
  const [activeHotspot, setActiveHotspot] = useState<string | null>(null);
  const active = hotspots.find(h => h.id === activeHotspot);

  return (
    <div className="relative w-full max-w-[1100px] mx-auto">
      {/* Iframe container */}
      <div className="relative rounded-xl overflow-hidden border border-[var(--border-light)] shadow-2xl shadow-black/60 aspect-[1280/800]">
        <iframe
          src="http://localhost:1420"
          className="absolute inset-0 w-full h-full border-0"
          title="RAV Interactive Demo"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
        />

        {/* Hotspot overlay */}
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

        {/* Callout */}
        {active && (
          <div
            className="absolute z-20 pointer-events-none animate-[fadeIn_150ms_ease-out]"
            style={{
              top: `calc(${active.top} + ${active.height})`,
              left: active.left,
              maxWidth: "320px",
            }}
          >
            <div className="mt-2 p-3 rounded-lg bg-[var(--bg-zinc)]/95 backdrop-blur-sm border border-[var(--neon)]/30 shadow-xl shadow-black/50">
              <p className="text-xs font-semibold text-[var(--neon)] mb-1 font-mono tracking-wider uppercase">
                {active.label}
              </p>
              <p className="text-[13px] text-[var(--text-dim)] leading-relaxed">
                {active.description}
              </p>
            </div>
          </div>
        )}

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[var(--bg-void)] to-transparent z-[5] pointer-events-none" />
      </div>

      {/* Hint text */}
      <p className="text-center text-[11px] text-[var(--text-ghost)] mt-3 font-mono">
        Hover over any region to explore the interface
      </p>
    </div>
  );
}
