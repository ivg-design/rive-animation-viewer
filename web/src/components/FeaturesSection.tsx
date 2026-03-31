import {
  Gamepad2,
  Terminal,
  AppWindow,
  Eye,
  FileCode,
  Palette,
  Code2,
  Maximize,
  Search,
  MousePointerClick,
  RotateCcw,
  Paintbrush,
  Cable,
  Layers,
} from "lucide-react";

const features = [
  {
    icon: Gamepad2,
    title: "ViewModel Controls",
    description: "Auto-discovered booleans, numbers, strings, triggers, enums, colors, and nested hierarchies with live runtime sync.",
  },
  {
    icon: Terminal,
    title: "Event Console",
    description: "Multi-source filtering (Native / Rive User / UI / MCP), text search, and expandable detail rows for every fired event.",
  },
  {
    icon: FileCode,
    title: "Standalone Export",
    description: "Self-contained HTML with embedded .riv, selected runtime (Canvas/WebGL2), pinned semver, and current layout state baked in.",
  },
  {
    icon: Eye,
    title: "Transparency Overlay",
    description: "Transparent window mode with cursor-synced click-through for compositing over other apps.",
  },
  {
    icon: Palette,
    title: "Script Editor",
    description: "CodeMirror 6 with JavaScript syntax, One Dark theme, and an Apply & Reload workflow.",
  },
  {
    icon: Search,
    title: "VM Explorer",
    description: "Console commands: vmExplore(), vmGet(), vmSet(), vmTree, vmPaths for runtime debugging.",
  },
  {
    icon: AppWindow,
    title: "Desktop Native",
    description: "Tauri v2 app with .riv file association, single-instance forwarding, and built-in DevTools.",
  },
  {
    icon: RotateCcw,
    title: "Value Persistence",
    description: "VM and state-machine values captured before reset and restored after reload automatically.",
  },
  {
    icon: Maximize,
    title: "Dual Renderer",
    description: "Switch between Canvas and WebGL2 on the fly. Runtime semver picker supports Latest (auto), pinned versions, and Custom.",
  },
  {
    icon: Paintbrush,
    title: "Background Controls",
    description: "Color picker, No BG reset for transparent canvas backgrounds, and per-export settings.",
  },
  {
    icon: Layers,
    title: "Artboard Switcher",
    description: "Switch artboards and animations from dropdowns. VM controls re-populate per artboard. Instance selector for multi-instance ViewModels.",
  },
  {
    icon: MousePointerClick,
    title: "State Machine Detection",
    description: "Auto-discovers and initializes state machines with live-synced boolean, number, and trigger inputs.",
  },
  {
    icon: Code2,
    title: "JS Configuration",
    description: "Write JavaScript objects for Rive initialization: artboards, state machines, autoplay, and custom options.",
  },
  {
    icon: Cable,
    title: "MCP Integration",
    description: "Control RAV from Claude Code via 24 MCP tools: open files, switch artboards, inspect ViewModels, drive playback, edit scripts, and export demos.",
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
