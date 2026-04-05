import {
  Gamepad2,
  Terminal,
  FileCode,
  Code2,
  MonitorCog,
  RotateCcw,
  Cable,
  Layers,
  Download,
  Maximize,
  MousePointerClick,
  Search,
} from "lucide-react";

const features = [
  {
    icon: Gamepad2,
    title: "ViewModel Controls",
    description: "Auto-discovered booleans, numbers, strings, triggers, enums, colors, and nested hierarchies with live two-way runtime sync.",
  },
  {
    icon: Layers,
    title: "Artboards + Playback",
    description: "Switch artboards, animations, and state machines from exact authored names. VM controls and instances repopulate for each target.",
  },
  {
    icon: Terminal,
    title: "Dual Consoles",
    description: "Event Console and JavaScript REPL share newest-first transcripts, timestamps, follow mode, level filters, and copy/clear actions.",
  },
  {
    icon: FileCode,
    title: "Export + Snippets",
    description: "Standalone HTML export and canonical CDN/local instantiation snippets with per-control selection, inline preview, and live-state serialization.",
  },
  {
    icon: Code2,
    title: "Script Editor",
    description: "CodeMirror 6 with internal-vs-editor live indication, APPLY action, and runtime re-instantiation that preserves artboard and control state.",
  },
  {
    icon: MonitorCog,
    title: "Renderer + Runtime",
    description: "Canvas and WebGL2 on the fly. Fit, alignment, and explicit fixed canvas sizing in the toolbar. Latest, pinned, or custom runtime semver.",
  },
  {
    icon: Maximize,
    title: "Canvas Sizing",
    description: "Pin to explicit pixel dimensions with aspect-ratio locking, or let the canvas auto-fill. Fixed sizes carry through to exports and snippets.",
  },
  {
    icon: Cable,
    title: "MCP Integration",
    description: "Bundled native sidecar with 32 tools. One-click installs for Claude Code, Claude Desktop, and Codex. Script Access gate. Editable port.",
  },
  {
    icon: RotateCcw,
    title: "State Preservation",
    description: "Refresh and reload flows preserve artboard, playback target, and bound control values. Reset restores captured state after re-instantiation.",
  },
  {
    icon: MousePointerClick,
    title: "State Machine Inputs",
    description: "Auto-discovers boolean, number, and trigger inputs for state machines and keeps them synchronized with the running runtime.",
  },
  {
    icon: Download,
    title: "Auto Updates",
    description: "Signed releases detected, downloaded, installed, and relaunched from the in-app update chip. Merged feed across all platforms.",
  },
  {
    icon: Search,
    title: "VM Explorer",
    description: "Inject the helper snippet for vmExplore, vmGet, vmSet, vmTree, and vmPaths runtime debugging via the JavaScript console.",
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="flex flex-col items-center gap-12 py-24 px-8 w-full">
      <div className="flex flex-col items-center gap-4">
        <span className="font-mono text-xs font-medium tracking-[3px] uppercase text-[var(--neon)]">
          Features
        </span>
        <h2 className="font-sans font-bold text-4xl text-[var(--text-white)]">
          Everything you need to inspect Rive files
        </h2>
        <p className="text-base text-[var(--text-muted)] max-w-[600px] text-center">
          A purpose-built desktop player for the Rive animation workflow.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-[1000px] w-full">
        {features.map((feature, index) => (
          <div
            key={feature.title}
            className="group flex flex-col gap-2 p-4 rounded-xl bg-[var(--bg-zinc)] border border-[var(--border-dark)] hover:border-[var(--neon-glow)] hover:bg-[var(--bg-elevated)] transition-all duration-300 opacity-0 animate-fade-in-up"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--neon-dim)] group-hover:bg-[var(--neon-glow)] transition-colors duration-300 flex-shrink-0">
                <feature.icon className="w-4 h-4 text-[var(--neon)]" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--text-white)] leading-tight">
                {feature.title}
              </h3>
            </div>
            <p className="text-xs text-[var(--text-dim)] leading-relaxed max-h-0 overflow-hidden group-hover:max-h-24 transition-[max-height] duration-300 ease-in-out">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
