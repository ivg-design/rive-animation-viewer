import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "Configuration" };

export default function Configuration() {
  return (
    <>
      <h1>Configuration</h1>

      <h2>Settings Panel</h2>

      <Image src={asset("/docs/settings-popover.webp")} alt="Settings panel showing runtime version picker, BG color, canvas sizing with AUTO/FIXED toggle, pixel dimensions with aspect lock, and About button" width={500} height={320} className="rounded-xl border border-[var(--border-dark)] my-4" />

      <p>The Settings gear in the toolbar opens the configuration panel with:</p>
      <ol>
        <li><strong>Runtime Ver</strong> &mdash; select Latest (auto), a pinned version, or Custom semver</li>
        <li><strong>BG Color</strong> &mdash; canvas background color picker with NO BG reset</li>
        <li><strong>Canvas Size</strong> &mdash; AUTO (fills viewport) or FIXED (explicit pixels)</li>
        <li><strong>Pixels</strong> &mdash; width and height inputs with aspect-ratio LOCK</li>
        <li><strong>About</strong> &mdash; opens the About window with build metadata and credits</li>
      </ol>

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
        In Settings, choose <strong>Latest (auto)</strong>, one of the latest four concrete
        versions, or <strong>Custom</strong> for manual semver input. The selected version is
        persisted per file and embedded in exports.
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
        exports and snippets.
      </p>
    </>
  );
}
