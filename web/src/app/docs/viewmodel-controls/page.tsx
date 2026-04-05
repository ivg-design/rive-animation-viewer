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

      <Image src={asset("/docs/vm-controls-panel.webp")} alt="Properties panel showing ViewModel and state machine controls with numbered callouts" width={400} height={900} className="rounded-xl border border-[var(--border-dark)] my-4" />

      <ol className="text-sm text-[var(--text-dim)] mb-6 list-none pl-0 flex flex-col gap-1">
        <li><strong className="text-[var(--neon)]">1</strong> ViewModel section &mdash; enum dropdowns, number inputs, boolean checkboxes, color picker with alpha, string inputs, collapsible nested instances</li>
        <li><strong className="text-[var(--neon)]">2</strong> State Machine section &mdash; boolean inputs discovered from the active state machine</li>
      </ol>

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
        </tbody>
      </table>

      <h2>Nested ViewModels</h2>
      <p>
        When a ViewModel contains nested properties, RAV renders them as collapsible sections
        with depth-colored accent bars. The root starts expanded; nested sections start collapsed.
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
        values and restores them after reload. Triggers are excluded since they are one-shot actions.
      </p>

      <h2>ViewModel Labels</h2>
      <p>
        Section headers display the exact name from the Rive file, preserving original casing,
        dashes, and special characters.
      </p>
    </>
  );
}
