import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "ViewModel Controls" };

export default function ViewModelControls() {
  return (
    <>
      <h1>ViewModel Controls</h1>

      <p>
        RAV automatically discovers ViewModel inputs from loaded animations and renders them
        as native controls in the right panel.
      </p>

      {/* Editorial layout: image left, callout legend right */}
      <div className="flex flex-col md:flex-row gap-6 my-8">
        <div className="md:w-1/2 flex-shrink-0">
          <Image src={asset("/docs/vm-controls-panel.webp")} alt="Properties panel showing ViewModel and state machine controls" width={400} height={900} className="rounded-xl border border-[var(--border-dark)] w-full" />
        </div>
        <div className="md:w-1/2 flex flex-col justify-center gap-4">
          <div className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#3b82f6] text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-white)] mb-1">ViewModel Section</h3>
              <p className="text-xs text-[var(--text-dim)] leading-relaxed">
                Enum dropdowns, number inputs, boolean checkboxes, color picker with alpha slider,
                string and image inputs, plus collapsible nested VM instances &mdash; all
                auto-discovered from the loaded animation.
              </p>
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#3b82f6] text-white text-xs font-bold flex items-center justify-center">2</span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-white)] mb-1">State Machine Section</h3>
              <p className="text-xs text-[var(--text-dim)] leading-relaxed">
                Boolean, number, and trigger inputs discovered from the active state machine,
                synchronized with the running runtime.
              </p>
            </div>
          </div>
        </div>
      </div>

      <h2>Supported Input Types</h2>
      <table>
        <thead>
          <tr><th>Type</th><th>Control</th><th>Behavior</th></tr>
        </thead>
        <tbody>
          <tr><td>Boolean</td><td>Checkbox</td><td>Immediately updates the runtime value</td></tr>
          <tr><td>Number</td><td>Text input</td><td>Accepts decimal values, updates on blur or Enter</td></tr>
          <tr><td>String</td><td>Text input</td><td>Updates on blur or Enter</td></tr>
          <tr><td>Trigger</td><td>Button</td><td>Fires the trigger once per click</td></tr>
          <tr><td>Enum</td><td>Dropdown</td><td>Lists all enum values, selects immediately</td></tr>
          <tr><td>Color</td><td>Color picker + alpha</td><td>Native color input with alpha slider</td></tr>
          <tr><td>Image</td><td>One full-width source select</td><td>Lists every embedded raster asset, then <strong>Open file…</strong> and <strong>Clear</strong>; the file input stays hidden and there are no separate action buttons</td></tr>
        </tbody>
      </table>

      <h2>Nested ViewModels</h2>
      <p>
        When a ViewModel contains nested properties, RAV renders them as collapsible sections
        with depth-colored accent bars. The root starts expanded; nested sections start collapsed.
      </p>

      <h2>Dynamic Lists</h2>
      <p>
        ViewModel lists show every item that currently exists &mdash; there is no ten-row cap.
        RAV first uses a direct authored instance name when the runtime exposes one. If the Web
        wrapper exposes only the definition&apos;s <code>viewModelName</code>, RAV compares readable
        string properties with that definition&apos;s canonical instance-name set and accepts only
        one unique match. Ambiguous or missing matches fall back to <strong>Row 1</strong>,
        <strong>Row 2</strong>, and so on; the generic definition name is never presented as an
        authored row label. When animation logic changes the controlling count, the Properties
        panel rebuilds from the live list topology automatically.
      </p>
      <p>
        In the validated <code>leaderboard_v4.riv</code> fixture, runtime order resolves exactly
        to <code>D10</code>, <code>D16</code>, <code>D03</code>, <code>D11</code>, <code>D06</code>,
        <code>D02</code>, <code>D18</code>, <code>D20</code>, <code>D19</code>, <code>D12</code>.
      </p>
      <p>
        MCP paths use the runtime&apos;s zero-based index even though labels are one-based. For
        example, <code>rows/0/playerName</code> addresses <strong>Row 1</strong>. Call
        <code> rav_get_vm_tree</code> after the list resizes to discover its current bounds.
      </p>

      <h2>Live Sync</h2>
      <p>
        Controls continuously sync with the runtime. If a value changes from animation logic,
        the UI updates automatically. Active focused inputs are skipped during sync to avoid
        disrupting edits.
      </p>

      <h2>Value Persistence</h2>
      <p>
        When you reset or restart an animation, RAV captures all ViewModel and state machine
        values and restores them after reload. If list items materialize a few frames later,
        pending values are retried until their live paths exist. Triggers are excluded since
        they are one-shot actions.
      </p>

      <h2>ViewModel Labels</h2>
      <p>
        Section headers display the exact name from the Rive file, preserving original casing,
        dashes, and special characters.
      </p>
      <h2>Embedded Images</h2>
      <p>
        RAV captures raster bytes embedded in the loaded <code>.riv</code> while leaving the
        runtime&apos;s normal asset loading intact. Each image property gets one full-width select:
        every captured raster appears first, followed by <strong>Open file…</strong> and
        <strong>Clear</strong>. <strong>Open file…</strong> invokes a hidden external file input.
        There is no separate folder button, separate clear button, or <code>Embedded image…</code>
        placeholder.
      </p>
      <p>
        Catalog entries use the runtime asset&apos;s <code>uniqueFilename</code> identity, determine
        PNG, WebP, JPEG, or AVIF MIME from the bytes rather than trusting an extension, and add
        numbered labels when display names repeat. The exact <code>leaderboard_v4.riv</code>
        contains two embedded rasters (<code>trophy-n2</code> and
        <code>avatar-placeholder</code>), one embedded font, and two embedded scripts; the image
        select intentionally catalogs only the two rasters. Standalone exports rebuild the same
        catalog and control.
      </p>
      <p>
        Selecting an image calls the loaded runtime&apos;s decoder; <strong>Clear</strong> writes
        <code>null</code>. Decoded image objects are live runtime values and are not included in
        JSON snapshots or generated control-value payloads.
      </p>
    </>
  );
}
