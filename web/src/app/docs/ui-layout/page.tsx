import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "UI Layout" };

export default function UiLayout() {
  return (
    <>
      <h1>UI Layout</h1>

      {/* Hero overview — full width with callout legend below */}
      <Image src={asset("/docs/ui-overview.webp")} alt="RAV full application layout with numbered callouts" width={960} height={600} className="rounded-xl border border-[var(--border-dark)] w-full mb-4" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        {[
          { n: 1, label: "Toolbar", desc: "Playback, renderer, fit, alignment" },
          { n: 2, label: "Script Editor", desc: "CodeMirror with live-source indicator" },
          { n: 3, label: "Canvas", desc: "Animation viewport and drop zone" },
          { n: 4, label: "Console", desc: "Event log or JavaScript REPL" },
          { n: 5, label: "Properties", desc: "VM controls, artboard switcher" },
        ].map((item) => (
          <div key={item.n} className="flex items-start gap-2 p-2 rounded-lg bg-[var(--bg-zinc)] border border-[var(--border-dark)]">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3b82f6] text-white text-[10px] font-bold flex items-center justify-center">{item.n}</span>
            <div>
              <span className="text-xs font-semibold text-[var(--text-white)] block">{item.label}</span>
              <span className="text-[10px] text-[var(--text-muted)]">{item.desc}</span>
            </div>
          </div>
        ))}
      </div>

      <h2>Top Toolbar</h2>
      <p>The toolbar is split into three clusters:</p>
      <ul>
        <li><strong>Left</strong> &mdash; app identity and the <strong>OPEN</strong> button for file loading</li>
        <li><strong>Center</strong> &mdash; reset, play, pause, renderer selector, fit, alignment, and FPS chip</li>
        <li><strong>Right</strong> &mdash; <strong>EXPORT</strong>, Settings gear, and MCP Setup (cable icon)</li>
      </ul>

      <h2>Script Editor</h2>

      {/* Editorial: editor states image left, explanation right */}
      <div className="flex flex-col md:flex-row gap-6 my-6">
        <div className="md:w-2/5 flex-shrink-0">
          <Image src={asset("/docs/editor-live-states.webp")} alt="Editor header in internal and editor-active states" width={400} height={60} className="rounded-lg border border-[var(--border-dark)] w-full" />
        </div>
        <div className="md:w-3/5 flex flex-col justify-center gap-3">
          <div className="flex gap-2 items-start">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3b82f6] text-white text-[10px] font-bold flex items-center justify-center">1</span>
            <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Internal mode</strong> &mdash; neutral outline, RAV&apos;s built-in wiring is active</p>
          </div>
          <div className="flex gap-2 items-start">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3b82f6] text-white text-[10px] font-bold flex items-center justify-center">2</span>
            <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Editor mode</strong> &mdash; green pulsing dot, applied editor config is driving the runtime</p>
          </div>
        </div>
      </div>

      <h2>Canvas</h2>
      <p>
        The primary animation viewport. Renders the loaded Rive animation with the selected
        renderer (Canvas or WebGL2). Fit and alignment are controlled from the main toolbar.
      </p>

      <h2>Properties Panel</h2>
      <p>
        Contains the Artboard/Animation switcher, ViewModel controls, and state machine inputs.
        Resizable by dragging the divider, collapsible entirely.
      </p>

      <h2>Console</h2>
      <p>
        Collapsible panel with two modes: Event Console and JavaScript Console. Both share
        newest-first ordering, timestamps, follow mode, and outlined action buttons (FOLLOW,
        COPY, CLEAR). A compact header toggle switches between Events and JS.
      </p>

      <h2>Runtime Strip</h2>
      <p>
        When the console is closed, only the runtime strip remains visible. It shows the MCP
        indicator, console toggle, runtime version, loaded file, update status, and playback
        state with structured iconography.
      </p>
    </>
  );
}
