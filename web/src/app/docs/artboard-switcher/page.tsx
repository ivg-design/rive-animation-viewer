import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "Artboard Switcher" };

export default function ArtboardSwitcher() {
  return (
    <>
      <h1>Artboard Switcher</h1>

      <p>
        RAV can display any artboard in a <code>.riv</code> file and switch between them
        without reloading the file. The Artboard / Animation control section appears in the
        Properties panel when a file is loaded.
      </p>

      <Image src={asset("/docs/artboard-switcher.webp")} alt="Artboard/Animation section showing artboard dropdown, playback dropdown, VM instance selector, and DEFAULT button" width={400} height={250} className="rounded-xl border border-[var(--border-dark)] my-6" />

      <h2>Artboard Dropdown</h2>
      <p>
        Lists every artboard in the loaded file. RAV prepares a replacement playback surface
        while keeping the last confirmed frame visible, then swaps only after the requested
        artboard, playback target, and ViewModel instance are ready. Rapid changes discard stale
        requests instead of flashing an intermediate surface.
      </p>

      <h2>Playback Dropdown</h2>
      <p>
        Shows the exact authored state machine and timeline animation names available on
        the selected artboard. Labels preserve original capitalization and formatting.
        State machines are listed first.
      </p>

      <h2>Timeline Progress</h2>
      <p>
        When the selected target is a timeline animation, the toolbar shows current and total
        progress. Select the readout to switch between frames and seconds. The meter is hidden
        for state machines and keeps a reserved footprint so surrounding controls do not shift.
      </p>

      <h2>VM Instance Selector</h2>
      <p>
        Whenever the selected artboard has a ViewModel instance, the dropdown is populated—even
        when there is only one. The default entry preserves Rive&apos;s automatic binding. Choosing a
        named or numbered instance reloads it with manual binding and re-renders the controls with
        that instance&apos;s values.
      </p>

      <h2>Reset to Default</h2>
      <p>
        The <strong>DEFAULT</strong> button returns to the artboard, playback target, and
        ViewModel binding detected when the file was first loaded. Playback and Properties are
        restored together on the confirmed visible surface.
      </p>

      <h2>Export Behavior</h2>
      <p>
        Standalone exports and generated snippets always capture the exact artboard, playback
        target, and ViewModel state currently shown in the viewer.
      </p>
    </>
  );
}
