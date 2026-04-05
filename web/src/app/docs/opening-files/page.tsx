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
        On macOS, RAV registers as a handler for <code>.riv</code> files. Double-click any
        <code>.riv</code> file in Finder to open it directly. If RAV is already running, the
        file is loaded into the existing window. On Windows, right-click a <code>.riv</code>
        file and choose &quot;Open with&quot; to associate RAV.
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
