import Image from "next/image";
import DocsFigure from "@/components/docs/DocsFigure";
import { asset } from "@/lib/config";

export const metadata = { title: "UI Layout" };

export default function UiLayout() {
  return (
    <>
      <h1>UI Layout</h1>

      <DocsFigure
        src={asset("/docs/2.5.3/workspace-root-vm.webp")}
        alt="RAV workspace with the editor on the left, animation canvas in the center, and Properties panel on the right"
        width={2500}
        height={1800}
        caption="The workspace keeps live source on the left, the playback canvas in the middle, and artboard, Global VM, and Root VM controls in Properties on the right."
      />

      <h2>Window Title</h2>
      <p>
        The title row centers the loaded file metadata against the full window, even when the app
        identity on the left and window controls on the right have different widths. The metadata
        keeps its intrinsic width; long directory paths truncate without pulling the visible title
        away from center.
      </p>

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
        In fixed-size mode, overflow-safe auto margins keep the canvas centered while it fits.
        When it becomes oversized, the margins collapse safely, scrolling starts from the
        authored top-left origin, and the central viewport exposes a styled 10px track, thumb,
        and corner for both axes.
      </p>

      <h2>Timeline Scrubber</h2>
      <p>
        Linear animations add a dedicated scrubber row immediately above the runtime status bar.
        Switch the readout between frames and seconds, use the duration-aware scale, or drag the
        large current-time indicator to seek. The indicator advances on every rendered animation
        frame during playback and remains fully visible at both ends of the track. State-machine
        playback hides the row entirely.
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

      <h2>About Window</h2>
      <div className="flex flex-col md:flex-row gap-6 my-6">
        <div className="md:w-3/5 flex-shrink-0">
          <Image src={asset("/docs/about-window.webp")} alt="About window with build matrix, credits, dependencies, product links, and Privacy Policy" width={600} height={400} className="rounded-xl border border-[var(--border-dark)] w-full" />
        </div>
        <div className="md:w-2/5 flex flex-col justify-center">
          <p className="text-sm text-[var(--text-dim)] leading-relaxed">
            Desktop builds include a custom About window accessible from the Settings
            popover or the native Help menu. It surfaces build metadata, runtime version,
            credits, product links including the Privacy Policy, and a scrollable dependency inventory.
          </p>
        </div>
      </div>
    </>
  );
}
