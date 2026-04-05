import {
  Gamepad2,
  Terminal,
  AppWindow,
  Eye,
  FileCode,
  RefreshCw,
  Code2,
  MonitorCog,
  Search,
  MousePointerClick,
  RotateCcw,
  Cable,
  Layers,
  Download,
  ShieldCheck,
} from "lucide-react";

const features = [
  {
    icon: Gamepad2,
    title: "ViewModel Controls",
    description: "Auto-discovered booleans, numbers, strings, triggers, enums, colors, and nested hierarchies with live runtime sync.",
  },
  {
    icon: Terminal,
    title: "Unified Consoles",
    description: "Event Console and JavaScript Console share timestamps, newest-first transcripts, FOLLOW behavior, consistent row chrome, and outlined copy/clear actions.",
  },
  {
    icon: FileCode,
    title: "Export + Snippets",
    description: "One Export flow for standalone HTML plus canonical CDN/local instantiation snippets with control-selection, Copy Code, live-state serialization, fixed canvas sizing carry-through, and slim zero-control output.",
  },
  {
    icon: Eye,
    title: "Transparency Overlay",
    description: "Transparent window mode with cursor-synced click-through for compositing over other apps.",
  },
  {
    icon: Code2,
    title: "Script Editor",
    description: "CodeMirror 6 editor with internal-vs-editor live indication, yellow APPLY action, and runtime re-instantiation without throwing away the active view.",
  },
  {
    icon: Search,
    title: "VM Explorer",
    description: "Inject the VM Explorer helper snippet and use vmExplore(), vmGet(), vmSet(), vmTree(), and vmPaths() for runtime debugging.",
  },
  {
    icon: AppWindow,
    title: "Desktop Native",
    description: "Tauri v2 desktop app with .riv association, open-with forwarding, drag/drop loading, a custom About window, single-instance file handoff, and a stabilized custom desktop header.",
  },
  {
    icon: RotateCcw,
    title: "State Preservation",
    description: "Refresh and reload flows preserve current artboard, playback, and bound control values as far as the runtime allows.",
  },
  {
    icon: MonitorCog,
    title: "Renderer + Runtime",
    description: "Switch between Canvas and WebGL2 on the fly, choose fit and alignment in the main toolbar, set an explicit canvas size with optional aspect lock, and pick Latest, the latest four versions, or Custom semver.",
  },
  {
    icon: Download,
    title: "Auto Updates",
    description: "Signed desktop releases can be detected, downloaded, installed, and relaunched directly from the in-app update chip.",
  },
  {
    icon: Layers,
    title: "Artboards + Playback",
    description: "Switch artboards, animations, and state machines from exact authored names while VM controls repopulate for the active target.",
  },
  {
    icon: MousePointerClick,
    title: "State Machine Inputs",
    description: "Auto-discovers boolean, number, and trigger inputs for state machines and keeps them synchronized with the running runtime.",
  },
  {
    icon: ShieldCheck,
    title: "MCP + Script Access",
    description: "Bundled native rav-mcp sidecar, stable launcher path, one-click add/reinstall/remove for supported clients, editable port, and a three-state MCP activity indicator.",
  },
  {
    icon: Cable,
    title: "MCP Integration",
    description: "Control RAV from agents through 32 MCP tools: open files, inspect state, set explicit canvas size, configure the workspace, drive playback, edit scripts, generate snippets, and export demos with the live console behavior preserved.",
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
            className="group flex flex-col gap-3 p-4 rounded-xl bg-[var(--bg-zinc)] border border-[var(--border-dark)] hover:border-[var(--neon-glow)] hover:bg-[var(--bg-elevated)] transition-all duration-300 opacity-0 animate-fade-in-up"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--neon-dim)] group-hover:bg-[var(--neon-glow)] transition-colors duration-300">
              <feature.icon className="w-4 h-4 text-[var(--neon)]" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-white)] leading-tight">
              {feature.title}
            </h3>
            <p className="text-xs text-[var(--text-dim)] leading-relaxed">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
