import { documentationMetadata } from "@/lib/seo";
import { asset } from "@/lib/config";
import DocsFigure from "@/components/docs/DocsFigure";

export const metadata = documentationMetadata("getting-started", "Open and Preview .riv Files", "Open a .riv file in RAV on macOS or Windows, choose an artboard and playback target, and test ViewModel values in the Properties panel.");

export default function GettingStarted() {
  return (
    <>
      <h1>Open and preview your first .riv file</h1>

      <p>
        RAV (Rive Animation Viewer) lets you preview a Rive runtime file on your desktop
        without setting up a web project. Open a <code>.riv</code>, choose what plays,
        then use its ViewModel controls to test the animation&apos;s response.
        You&apos;ll need RAV and a <code>.riv</code> file exported from Rive.
      </p>
      <p>
        Already installed? <a href="#open-a-riv-file">Jump to opening your file</a>.
        Looking for the app? <a href={asset("/#downloads")}>Choose a RAV download</a>.
      </p>

      <h2 id="installation">Install RAV</h2>
      <p>
        RAV is available as a desktop application for macOS (Apple Silicon and Intel) and Windows.
        Download the latest release from the{" "}
        <a href="https://github.com/ivg-design/rive-animation-viewer/releases" target="_blank" rel="noopener noreferrer">
          GitHub Releases
        </a> page.
      </p>

      <h3>macOS</h3>
      <ol>
        <li>Download the <code>.dmg</code> file for your architecture (Apple Silicon or Intel)</li>
        <li>Open the DMG and drag RAV to your Applications folder</li>
        <li>Launch RAV normally. Current releases are Developer ID signed, notarized, and stapled for Gatekeeper.</li>
        <li>Use <strong>Open With &rarr; RAV</strong> for a <code>.riv</code> file. Installation keeps your existing default app; see <a href={asset("/docs/opening-files")}>file associations</a> if you want double-clicking to open RAV.</li>
      </ol>

      <h3>Windows</h3>
      <ol>
        <li>Download the x64 setup <code>.exe</code> or <code>.msi</code> installer</li>
        <li>Run the installer and follow the setup wizard</li>
        <li>RAV will be available from the Start menu and registers its dedicated <code>.riv</code> document icon</li>
      </ol>

      <h2 id="open-a-riv-file">1. Open a .riv file</h2>
      <p>
        Launch RAV and click <strong>OPEN</strong> in the top toolbar, or drag your
        <code> .riv</code> onto the window. The file loads into the canvas using its
        default playback target. Use a runtime <code>.riv</code> export; a Rive
        source project (<code>.rev</code>) cannot be opened directly.
      </p>
      <DocsFigure
        src={asset("/docs/2.5.6/workspace-root-vm.webp")}
        alt="RAV previewing an NBA leaderboard, with OPEN in the toolbar and Artboard, Playback, VM Instance and ViewModel controls in the right-hand Properties panel"
        width={2500}
        height={1800}
        caption="An existing leaderboard file in RAV: the canvas shows playback, while Properties exposes the targets and values authored in that file. Your file will have its own names and controls."
      />

      <h2 id="choose-playback">2. Choose the artboard and playback</h2>
      <p>
        In <strong>Properties &rarr; Artboard / Animation</strong>, choose an
        <strong> Artboard</strong>, then a <strong>Playback</strong> target. The list
        contains the state machines and timeline animations authored on that artboard.
        Choose a state machine to test an interactive flow, or a timeline animation
        to preview a specific sequence.
      </p>
      <p>
        Use the toolbar&apos;s play and pause controls. A timeline animation also shows
        a scrubber above the bottom status bar; drag its playhead to pause and inspect
        a frame. State machines do not show that fixed-duration scrubber. For an
        overview of the full artboard, choose <strong>Fit: Contain</strong> in the toolbar.
      </p>
      <p>
        See <a href={asset("/docs/artboard-switcher")}>artboards, playback and VM instances</a> for
        the full selection controls.
      </p>

      <h2 id="test-viewmodel-values">3. Test ViewModel values</h2>
      <p>
        Expand a ViewModel section in <strong>Properties</strong>. RAV shows controls
        for the properties available in the loaded file. Try one change at a time:
      </p>
      <ul>
        <li>Change a <strong>number</strong> or toggle a <strong>boolean</strong> and watch the canvas.</li>
        <li>Edit a <strong>string</strong>, then press Enter or leave the field to apply it.</li>
        <li>Click <strong>Fire</strong> on a <strong>trigger</strong> to send that one-shot action.</li>
        <li>If the artboard exposes different authored instances, use <strong>VM Instance</strong> to try their values.</li>
      </ul>
      <p>
        A visible response depends on how the file&apos;s animation is bound to that
        property. For example, the leaderboard above exposes a <code>numRowVisible</code>
        number and a <code>populate</code> trigger; those names belong to that file,
        not every Rive animation. RAV exposes ViewModel properties here, not legacy
        state-machine input controls.
      </p>
      <p>
        Learn more about <a href={asset("/docs/viewmodel-controls")}>ViewModel controls, nested values and lists</a>.
      </p>

      <h2 id="if-nothing-changes">If nothing moves or no controls appear</h2>
      <ul>
        <li><strong>No motion:</strong> check Playback and press play. An interactive state machine may wait for a pointer action or a ViewModel change.</li>
        <li><strong>No ViewModel controls:</strong> the file or selected artboard may have no writable ViewModel properties. Check the Artboard selection and, when available, VM Instance. A file can contain animation without editable properties.</li>
        <li><strong>A value changes but the canvas does not:</strong> check that the selected playback target uses that property. A control is not a guarantee of a visible effect.</li>
        <li><strong>A file fails to load:</strong> check the <a href={asset("/docs/consoles")}>console</a> and the <a href={asset("/docs/troubleshooting")}>troubleshooting guide</a> before changing runtime settings.</li>
      </ul>
      <p>
        Once playback and controls work, explore <a href={asset("/docs/export")}>standalone HTML and code snippets</a> or
        <a href={asset("/docs/media-export")}> media export and recording</a> in the desktop app.
      </p>

      <h2 id="local-browser-mode">For developers: browser preview</h2>
      <p>
        The repository also includes a browser development viewer. It is not the
        desktop installation path: a source checkout without the separately
        distributed inspection module cannot open files, and browser-only runs
        do not provide the native export workflow. Follow the
        <a href="https://github.com/ivg-design/rive-animation-viewer#quick-start" target="_blank" rel="noopener noreferrer"> repository setup instructions</a> if
        you are developing RAV; use the desktop release for this walkthrough.
      </p>
    </>
  );
}
