import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "Configuration" };

export default function Configuration() {
  return (
    <>
      <h1>Configuration</h1>

      <h2>Settings Panel</h2>

      <Image src={asset("/docs/settings-popover.webp")} alt="Settings panel showing runtime version, background color, canvas sizing, Anonymous Usage, and About controls" width={500} height={320} className="rounded-xl border border-[var(--border-dark)] my-4" />

      <p>The Settings gear in the toolbar opens the configuration panel with:</p>
      <ol>
        <li><strong>Runtime Ver</strong> &mdash; defaults to Latest (auto), with concrete versions and Custom semver available as explicit pins</li>
        <li><strong>BG Color</strong> &mdash; canvas background color picker with NO BG reset</li>
        <li><strong>Canvas Size</strong> &mdash; AUTO (fills viewport) or FIXED (explicit pixels)</li>
        <li><strong>Pixels</strong> &mdash; width and height inputs with aspect-ratio LOCK</li>
        <li><strong>Anonymous Usage</strong> &mdash; enables or disables anonymous installed-version reporting</li>
        <li><strong>Default .riv App</strong> &mdash; shows the application macOS currently resolves for both Rive content identifiers, with deliberate MAKE DEFAULT or REPAIR ICON actions when available</li>
        <li><strong>About</strong> &mdash; opens build metadata, credits, dependencies, product links, and the Privacy Policy</li>
      </ol>

      <p className="text-sm text-[var(--text-dim)]">
        The default-app row changes double-click/open-with handling and document registration only.
        Finder can repaint cached icons later, and Quick Look previews are supplied by a separate
        macOS provider.
      </p>

      <p className="text-sm text-[var(--text-dim)]">
        For the script editor, supported config keys, APPLY behavior, internal vs editor
        live mode, and the <code>window.riveInst</code> surface, see{" "}
        <a href={asset("/docs/script-editor")} className="text-[var(--neon)] hover:underline">Script Editor</a>.
      </p>

      <h2>Renderer Selection</h2>
      <p>
        Choose between <strong>Canvas</strong> and <strong>WebGL2</strong> in the toolbar.
        WebGL2 is recommended for vector feathering and complex animations.
      </p>

      <h2>Runtime Version</h2>
      <p>
        RAV 2.5.2 defaults to <strong>Latest (auto)</strong> and resolves the current npm runtime
        before playback. If version discovery is unavailable, 2.39.2 is the fallback.
        Live RAV MCP comparison previously proved that Web 2.40.0 / runtime-v0.1.271 can
        double-offset nested, data-bound images in both WebGL2 and Canvas, so that exact version
        remains labeled with an authored-layout warning.
      </p>
      <p>
        You can choose one of the concrete versions or <strong>Custom</strong> for a manual semver
        pin. Explicit global and per-file selections remain persisted and are embedded as the
        resolved concrete runtime version in exports.
      </p>

      <h2>Layout</h2>
      <p>Fit and alignment are surfaced directly in the main toolbar:</p>
      <table>
        <thead><tr><th>Fit</th><th>Behavior</th></tr></thead>
        <tbody>
          <tr><td><code>contain</code></td><td>Fit entirely within canvas, preserving aspect ratio</td></tr>
          <tr><td><code>cover</code></td><td>Fill canvas, cropping as needed</td></tr>
          <tr><td><code>fill</code></td><td>Stretch to fill (may distort)</td></tr>
          <tr><td><code>fitWidth</code></td><td>Match canvas width, overflow height</td></tr>
          <tr><td><code>fitHeight</code></td><td>Match canvas height, overflow width</td></tr>
          <tr><td><code>scaleDown</code></td><td>Only shrink if larger than canvas</td></tr>
          <tr><td><code>none</code></td><td>No scaling, original size</td></tr>
          <tr><td><code>layout</code></td><td>Rive layout mode</td></tr>
        </tbody>
      </table>

      <h2>Canvas Sizing</h2>
      <p>
        In Settings, switch between <strong>AUTO</strong> (canvas fills the viewport) and
        <strong>FIXED</strong> (explicit pixel width and height). When fixed, an aspect-ratio
        lock keeps dimensions proportional while editing. Fixed sizes carry through to
        exports and snippets. Overflow-safe auto margins keep a fixed canvas centered while it
        fits; when it exceeds the viewport, the margins collapse and the canvas scrolls from the
        authored top-left origin with a styled 10px track, thumb, and corner.
      </p>
      <p>
        A Fixed size defines the playback canvas viewport; it does not resize the authored Rive
        artboard. With <code>contain</code>, one artboard dimension always reaches the matching
        canvas edge, so alignment only moves visibly on the other axis when that axis has unused
        space. For example, a 16:9 artboard in a taller 500 × 409 canvas fills the width, making
        Top, Center, and Bottom visible while Left and Right have no horizontal space to use.
      </p>
    </>
  );
}
