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
        <li>The raw applied editor config and lifecycle callbacks when Editor mode is active</li>
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
        <li><strong>Package source</strong> &mdash; CDN vs LOCAL (see below)</li>
        <li><strong>Snippet mode</strong> &mdash; COMPACT vs SCAFFOLD (see below)</li>
        <li><strong>Inline preview</strong> &mdash; live code preview with COPY button</li>
        <li><strong>GENERATE SNIPPET</strong> &mdash; copies the snippet to clipboard</li>
        <li><strong>EXPORT</strong> &mdash; saves a standalone HTML file</li>
      </ul>

      <h3>Package source: CDN vs LOCAL</h3>
      <p>
        Controls how the generated snippet pulls in the Rive runtime.
      </p>
      <ul>
        <li>
          <strong>CDN</strong> (default) &mdash; emits a runtime <code>&lt;script&gt;</code> tag pointing
          at the pinned <code>@rive-app/webgl2</code> or <code>@rive-app/canvas</code>
          version on jsDelivr, then attaches helpers to <code>window.ravRive</code>.
          Drop-in for static HTML, design tools, prototypes, and CodePen.
        </li>
        <li>
          <strong>LOCAL</strong> &mdash; emits ES-module <code>import</code> statements that resolve
          against your project&rsquo;s <code>node_modules</code> (e.g. <code>import &lcub; Rive &rcub; from
          &quot;@rive-app/webgl2&quot;</code>). Pick this when you&rsquo;re inside a bundler &mdash;
          Vite, Next.js, Webpack &mdash; so version pinning, tree-shaking, and TypeScript
          types come from your own <code>package.json</code>.
        </li>
      </ul>

      <h3>Snippet mode: COMPACT vs SCAFFOLD</h3>
      <p>
        Controls how much of the bound control surface ends up in the snippet body.
      </p>
      <ul>
        <li>
          <strong>COMPACT</strong> (default) &mdash; only the controls you ticked in the tree
          appear, with their current live values inlined. Smallest, ready-to-paste form
          for a finished embed where you just want this one configuration to render.
        </li>
        <li>
          <strong>SCAFFOLD</strong> &mdash; emits every available control on the loaded animation,
          but comments out the unselected ones with their default values. Ideal as a
          starter template &mdash; you can uncomment lines later to expose more controls
          without re-opening RAV. Pairs well with SELECT ALL or CHANGED ONLY presets when
          you want a documented map of the full control surface.
        </li>
      </ul>

      <p>
        These two axes are independent &mdash; CDN + COMPACT is the default for prototyping
        embeds, LOCAL + SCAFFOLD is the most useful when you&rsquo;re pulling the snippet
        into an app and want all controls documented. MCP clients can drive both via the
        <code>package_source</code> and <code>snippet_mode</code> arguments on
        <code>generate_web_instantiation_code</code> and <code>rav_export_demo_visual</code>.
      </p>

      <h2>Exporting Workflow</h2>
      <ol>
        <li>Load and configure your animation in RAV</li>
        <li>Adjust playback, runtime, controls, and canvas sizing to the desired state</li>
        <li>Click <strong>EXPORT</strong> in the toolbar</li>
        <li>Use the dialog to curate which controls are serialized</li>
        <li>Copy the snippet directly or save a standalone HTML file</li>
      </ol>

      <p>
        Applied editor callbacks and non-toolbar config execute in the exported standalone page
        after its binding and snapshot-restore lifecycle. Changes still marked as an unapplied
        draft remain out of the export.
      </p>

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
