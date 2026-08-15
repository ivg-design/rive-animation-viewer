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
        On macOS, 2.4.4 exports one canonical <code>app.rive.animation.viewer.riv</code>
        UTI for <code>.riv</code>, conforms it to <code>public.data</code> and
        <code>public.content</code>, and claims the document as Viewer/Owner. The dedicated
        <code>RiveFileIcon.icns</code> is assigned in both the UTI and document declarations.
        Double-click or use Open With to load a file directly; if RAV is already running, the file
        is routed into the existing window.
      </p>
      <p>
        After an app update, the first launch of the new version refreshes that installed bundle&apos;s
        Launch Services registration once for the version and schema, without restarting Finder or
        changing the Viewer/Owner rank. Public promotion is separately gated on installing the exact
        signed Apple Silicon candidate while Rive Editor and Rive Early Access are registered, then
        checking both existing and freshly created <code>.riv</code> files through Finder and
        NSWorkspace. The isolated signed-updater receipt skips Launch Services registration and does
        not substitute for that installed-app check.
      </p>
      <p>
        On Windows, both the NSIS setup executable and MSI package install a dedicated
        ten-resolution <code>RiveFileIcon.ico</code> for <code>.riv</code> documents. The NSIS
        updater rewrites the document-icon registration and notifies Explorer on every update;
        uninstall restores the association that existed before RAV. MSI owns the equivalent
        registry value as an upgrade-aware component and removes it on uninstall. Right-click a
        <code>.riv</code> file and choose &quot;Open with&quot; if you want RAV to be its active handler.
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
