export const metadata = { title: "Opening Files" };

export default function OpeningFiles() {
  return (
    <>
      <h1>Opening Files</h1>

      <h2>Drag and Drop</h2>
      <p>
        Drag any <code>.riv</code> file onto the RAV window to load it. The animation begins
        playing immediately using the default playback target.
      </p>

      <h2>File Dialog</h2>
      <p>
        Click the <strong>OPEN</strong> button in the toolbar to browse your filesystem and
        select a <code>.riv</code> file.
      </p>

      <h2>Double-Click (Desktop)</h2>
      <p>
        On macOS, RAV registers the official <code>app.rive.editor.rive-file</code> UTI as an
        alternate Viewer for <code>.riv</code> files and uses the dedicated Rive file icon.
        Use Open With or an existing Finder association to open any <code>.riv</code> file
        directly. If RAV is already running, the file is routed into the existing window;
        RAV does not claim the default handler. After an app update, the first launch of the
        new version refreshes that bundle&apos;s Launch Services registration once for the version
        without restarting Finder or changing the Viewer/Alternate rank. On Windows, right-click
        a <code>.riv</code> file and choose &quot;Open with&quot; to associate RAV.
      </p>

      <h2>Supported Formats</h2>
      <p>
        RAV supports Rive runtime files (<code>.riv</code>). These are the compiled binary
        output from the <a href="https://rive.app" target="_blank" rel="noopener noreferrer">Rive Editor</a>.
        Source <code>.rev</code> project files cannot be opened directly.
      </p>
    </>
  );
}
