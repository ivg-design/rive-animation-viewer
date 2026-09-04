import Link from "next/link";
import DocsFigure from "@/components/docs/DocsFigure";
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

      <p>
        Video, animated-image, and still-image output uses the separate desktop
        <Link href={asset("/docs/media-export")}> Media Export &amp; Recording</Link> workflow in
        the same <strong>EXPORT</strong> menu.
      </p>

      <p>
        These are separate outputs. A snippet is intentionally small setup code plus a
        <code> window.riveProperties</code> object containing only the property accessors you
        selected. A standalone HTML export includes the runtime, embedded animation, viewer UI
        chrome, controls, and selected-value restoration.
      </p>

      <h2>What Gets Exported</h2>
      <ul>
        <li>The <code>.riv</code> binary, base64-encoded and embedded</li>
        <li>The selected runtime (Canvas or WebGL2) bundled inline</li>
        <li>The selected runtime semver baked in</li>
        <li>The current artboard, playback target, and active live source mode</li>
        <li>Only the checked or changed ViewModel / state-machine values</li>
        <li>The embedded raster catalog used by each image property&apos;s single source select</li>
        <li>The raw applied editor config and lifecycle callbacks when Editor mode is active</li>
        <li>The generated canonical instantiation snippet (CDN and local variants)</li>
        <li>Canvas sizing mode (auto or fixed pixel dimensions)</li>
        <li>Complete styling for standalone viewing</li>
      </ul>

      <h2>Snippet &amp; Export Controls</h2>

      <DocsFigure
        src={asset("/docs/2.5.5/snippet-export-settings.webp")}
        alt="RAV snippet settings with three selected ViewModel properties and a compact CDN code preview"
        width={2500}
        height={1800}
        caption="A compact snippet contains setup plus only the selected property accessors. Standalone HTML remains a separate complete export with its own UI chrome."
      />

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
          version on unpkg, then attaches selected property accessors to
          <code> window.riveProperties</code>.
          Drop-in for static HTML, design tools, prototypes, and CodePen.
        </li>
        <li>
          <strong>LOCAL</strong> &mdash; emits ES-module <code>import</code> statements that resolve
          against your project&rsquo;s <code>node_modules</code> (e.g. <code>import * as rive from
          &quot;@rive-app/webgl2&quot;</code>). Pick this when you&rsquo;re inside a bundler &mdash;
          Vite, Next.js, Webpack &mdash; so version pinning, tree-shaking, and TypeScript
          types come from your own <code>package.json</code>.
        </li>
      </ul>

      <h3>Snippet mode: COMPACT vs SCAFFOLD</h3>
      <p>
        Controls how much of the bound accessor surface ends up in the snippet body.
      </p>
      <ul>
        <li>
          <strong>COMPACT</strong> (default) &mdash; only the controls you ticked in the tree
          appear as direct typed runtime accessors. Captured values are not inlined. This is
          the smallest ready-to-paste form for wiring the properties your page actually uses.
        </li>
        <li>
          <strong>SCAFFOLD</strong> &mdash; emits every available control on the loaded animation,
          but comments out the unselected accessor lines. Use it as a starter map when you
          expect to expose more controls later: uncomment the lines you need
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
        <li>Use the dialog to choose snippet accessors and standalone-export values</li>
        <li>Copy the snippet directly or save a standalone HTML file</li>
      </ol>

      <p>
        Applied editor callbacks and non-toolbar config execute in the exported standalone page
        after its binding and snapshot-restore lifecycle. Changes still marked as an unapplied
        draft remain out of the export.
      </p>

      <h2>ViewModel Control Parity</h2>
      <p>
        Standalone exports rebuild the live ViewModel list-label resolver and embedded-image
        catalog. Authored list labels therefore follow the same direct-name or unique
        canonical-string rule, with ambiguous items falling back to <strong>Row N</strong>, and
        image properties retain one full-width select containing every embedded raster asset,
        <strong>Open file…</strong>, and <strong>Clear</strong>, backed by a hidden file input.
        The catalog preserves <code>uniqueFilename</code> identity, magic-byte MIME detection,
        and duplicate-name disambiguation.
      </p>

      <p>
        Generated snippets do not rebuild this control panel. They expose selected accessors such
        as <code>window.riveProperties[&quot;viewModel/card/title&quot;]</code>, whose
        <code> value</code> or <code>fire()</code>/<code>trigger()</code> API can be used directly
        from the host page.
      </p>

      <h2>Canvas Sizing in Exports</h2>
      <p>
        When the viewer is pinned to a fixed canvas size, exported demos and generated
        snippets preserve those exact pixel dimensions. In RAV, overflow-safe auto margins keep
        a fixed canvas centered while it fits; once it exceeds the viewport, those margins
        collapse so scrolling starts at the authored top-left origin.
      </p>

      <h2>Limitations</h2>
      <ul>
        <li>WebGL2 exports require a browser with WebGL2 support</li>
        <li>File size depends on the embedded <code>.riv</code> animation</li>
      </ul>
    </>
  );
}
