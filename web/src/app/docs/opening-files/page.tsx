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
        On macOS, the 2.4.3 candidate declares both the official
        <code>app.rive.editor.rive-file</code> UTI and the legacy
        <code>app.rive.animation.viewer.riv</code> compatibility UTI as alternate Viewer types,
        with the dedicated <code>RiveFileIcon.icns</code> assigned to both. Use Open With or an
        existing Finder association to open any <code>.riv</code> file directly. If RAV is already
        running, the file is routed into the existing window; RAV does not claim the default handler.
      </p>
      <p>
        After an app update, the first launch of the new version refreshes that installed bundle&apos;s
        Launch Services registration once for the version and schema, without restarting Finder or
        changing the Viewer/Alternate rank. The declarations, icon resource, and refresh logic have
        passed local bundle checks. Exact migration of an already-indexed Finder icon is still pending
        separate installed-app verification and is not established by the isolated signed-updater
        receipt, which skips Launch Services registration. On Windows,
        right-click a <code>.riv</code> file and choose &quot;Open with&quot; to associate RAV.
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
