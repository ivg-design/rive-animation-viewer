import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "Export + Snippets" };

export default function Export() {
  return (
    <>
      <h1>Export + Snippets</h1>

      <p>
        RAV can export self-contained HTML demo files and generate canonical web
        instantiation snippets for embedding animations in your codebase.
      </p>

      <h2>What Gets Exported</h2>
      <ul>
        <li>The <code>.riv</code> binary, base64-encoded and embedded</li>
        <li>The selected runtime (Canvas or WebGL2) bundled inline</li>
        <li>The selected runtime semver baked in</li>
        <li>The current artboard, playback target, and active live source mode</li>
        <li>Only the checked or changed ViewModel / state-machine values</li>
        <li>The generated canonical instantiation snippet (CDN and local variants)</li>
        <li>Canvas sizing mode (auto or fixed pixel dimensions)</li>
        <li>Complete styling for standalone viewing</li>
      </ul>

      <h2>Snippet &amp; Export Controls</h2>

      <Image src={asset("/docs/export-controls.webp")} alt="Snippet and Export Controls dialog showing tree checkboxes, selection count, mode toggles, and inline code preview" width={800} height={500} className="rounded-xl border border-[var(--border-dark)] my-4" />

      <p>
        The export dialog is shared by snippet generation and standalone export. It provides:
      </p>
      <ul>
        <li><strong>Tree checkboxes</strong> &mdash; branch checkboxes select entire nested sections, leaf checkboxes select individual controls</li>
        <li><strong>Presets</strong> &mdash; CHANGED ONLY (default), SELECT ALL, CLEAR</li>
        <li><strong>Mode toggles</strong> &mdash; SNIPPET vs CDN vs SCAFFOLD for output format</li>
        <li><strong>Inline preview</strong> &mdash; live code preview with COPY button</li>
        <li><strong>GENERATE SNIPPET</strong> &mdash; copies the snippet to clipboard</li>
        <li><strong>EXPORT</strong> &mdash; saves a standalone HTML file</li>
      </ul>

      <h2>Exporting Workflow</h2>
      <ol>
        <li>Load and configure your animation in RAV</li>
        <li>Adjust playback, runtime, controls, and canvas sizing to the desired state</li>
        <li>Click <strong>EXPORT</strong> in the toolbar</li>
        <li>Use the dialog to curate which controls are serialized</li>
        <li>Copy the snippet directly or save a standalone HTML file</li>
      </ol>

      <h2>Canvas Sizing in Exports</h2>
      <p>
        When the viewer is pinned to a fixed canvas size, exported demos and generated
        snippets preserve those exact pixel dimensions. The canvas stays centered in the
        viewport rather than pinning to the upper-left corner.
      </p>

      <h2>Limitations</h2>
      <ul>
        <li>WebGL2 exports require a browser with WebGL2 support</li>
        <li>File size depends on the embedded <code>.riv</code> animation</li>
      </ul>
    </>
  );
}
