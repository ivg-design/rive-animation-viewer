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
        On macOS, current RAV releases declare both the official
        <code>app.rive.editor.rive-file</code> UTI and the legacy
        <code>app.rive.animation.viewer.riv</code> compatibility UTI as alternate Viewer types,
        with the dedicated <code>RiveFileIcon.icns</code> assigned to both. RAV does not silently
        replace your chosen default app during installation. To choose it deliberately, open
        Settings and use <strong>MAKE DEFAULT</strong> beside <strong>Default .riv App</strong>.
        The live status checks both identifiers and names the resolved application, including
        another installed RAV copy. <strong>REPAIR ICON</strong> re-registers the installed
        app&apos;s document declarations when RAV is already the default. If RAV is running, a
        double-clicked file is queued into the existing window and replaces playback after the
        new surface is ready.
      </p>
      <p>
        After an app update, the first launch of the new version refreshes that installed bundle&apos;s
        Launch Services registration once for the version and schema, without restarting Finder or
        changing the Viewer/Alternate rank. The declarations include the dedicated document icon
        resource and support both the current and legacy RAV file identifiers. Finder can repaint a
        cached document icon later than the registration itself; this setting does not install or
        repair a separate Quick Look preview provider.
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
