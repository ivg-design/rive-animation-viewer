import type { Metadata } from "next";
import Link from "next/link";
import { Download, Layers, Monitor, Gamepad2, Terminal, FileCode, Settings, Cable, RefreshCw, Keyboard, HelpCircle, LayoutGrid } from "lucide-react";
import { asset } from "@/lib/config";
import { toCanonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "RAV Documentation",
  description: "Complete guide to using Rive Animation Viewer — installation, ViewModel controls, consoles, MCP integration, export, and configuration.",
  alternates: { canonical: toCanonicalUrl("/docs") },
};

const topics = [
  { icon: Download, title: "Getting Started", desc: "Installation and first launch", href: "/docs/getting-started" },
  { icon: Layers, title: "Opening Files", desc: "Load .riv files", href: "/docs/opening-files" },
  { icon: Monitor, title: "UI Layout", desc: "Toolbar, panels, and runtime strip", href: "/docs/ui-layout" },
  { icon: Gamepad2, title: "ViewModel Controls", desc: "Auto-discovered inputs", href: "/docs/viewmodel-controls" },
  { icon: LayoutGrid, title: "Artboard Switcher", desc: "Switch artboards and animations", href: "/docs/artboard-switcher" },
  { icon: Terminal, title: "Consoles", desc: "Event log and JavaScript REPL", href: "/docs/consoles" },
  { icon: FileCode, title: "Export + Snippets", desc: "Standalone HTML and instantiation code", href: "/docs/export" },
  { icon: Settings, title: "Configuration", desc: "Editor modes, renderer, runtime, canvas sizing", href: "/docs/configuration" },
  { icon: Cable, title: "MCP Integration", desc: "32 tools, bundled sidecar, Script Access", href: "/docs/mcp" },
  { icon: RefreshCw, title: "Auto Updates", desc: "Built-in updater flow", href: "/docs/updates" },
  { icon: Keyboard, title: "Keyboard Shortcuts", desc: "All implemented keybindings", href: "/docs/shortcuts" },
  { icon: HelpCircle, title: "Troubleshooting", desc: "Common issues and fixes", href: "/docs/troubleshooting" },
];

export default function DocsLanding() {
  return (
    <>
      <section className="text-center mb-12">
        <h1 className="text-4xl font-bold text-[var(--text-white)] mb-4">RAV Documentation</h1>
        <p className="text-lg text-[var(--text-dim)] max-w-2xl mx-auto">
          Complete guide to Rive Animation Viewer — from installation to MCP remote control.
        </p>
      </section>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {topics.map((topic) => (
          <Link
            key={topic.title}
            href={asset(topic.href)}
            className="group flex flex-col items-center gap-3 p-5 rounded-xl bg-[var(--bg-zinc)] border border-[var(--border-dark)] hover:border-[var(--neon-glow)] hover:bg-[var(--bg-elevated)] transition-all duration-300 text-center"
          >
            <topic.icon className="w-6 h-6 text-[var(--text-muted)] group-hover:text-[var(--neon)] transition-colors" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-white)]">{topic.title}</h3>
              <p className="text-xs text-[var(--text-muted)] mt-1">{topic.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
