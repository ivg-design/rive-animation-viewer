import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "UI Layout" };

export default function UiLayout() {
  return (
    <>
      <h1>UI Layout</h1>

      <Image src={asset("/docs/ui-overview.webp")} alt="RAV full application layout with numbered callouts" width={960} height={600} className="rounded-xl border border-[var(--border-dark)] mb-6" />

      <p>RAV uses a three-panel layout optimized for animation inspection:</p>

      <h2>Top Toolbar</h2>
      <p>The toolbar is split into three clusters:</p>
      <ul>
        <li><strong>Left</strong> &mdash; app identity and the <strong>OPEN</strong> button for file loading</li>
        <li><strong>Center</strong> &mdash; reset, play, pause, renderer selector, fit, alignment, and FPS chip</li>
        <li><strong>Right</strong> &mdash; <strong>EXPORT</strong>, Settings gear, and MCP Setup (cable icon)</li>
      </ul>

      <h2>Left Panel &mdash; Script Editor</h2>
      <p>
        An optional panel with a CodeMirror 6 editor for writing JavaScript configuration
        objects. The <strong>EDITOR</strong> title block doubles as the live-source indicator:
        neutral outline means internal wiring is active, green with a pulsing dot means the
        applied editor config is driving the runtime.
      </p>

      <Image src={asset("/docs/editor-live-states.webp")} alt="Editor header in internal (1) and editor-active (2) states" width={400} height={60} className="rounded-lg border border-[var(--border-dark)] my-4" />

      <h2>Center Panel &mdash; Canvas</h2>
      <p>
        The primary animation viewport. Renders the loaded Rive animation with the selected
        renderer (Canvas or WebGL2). Fit and alignment are controlled from the main toolbar.
      </p>

      <h2>Right Panel &mdash; Properties</h2>
      <p>
        Contains the Artboard/Animation switcher, ViewModel controls, and state machine inputs.
        Resizable by dragging the divider, collapsible entirely.
      </p>

      <h2>Bottom Panel &mdash; Console</h2>
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
