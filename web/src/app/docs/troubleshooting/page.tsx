export const metadata = { title: "Troubleshooting" };

export default function Troubleshooting() {
  return (
    <>
      <h1>Troubleshooting</h1>

      <h2>Animation won&apos;t load</h2>
      <ul>
        <li>Verify the file is a valid <code>.riv</code> file (not a <code>.rev</code> project file)</li>
        <li>Check the event console for error messages</li>
        <li>Try switching between Canvas and WebGL2 renderers</li>
        <li>Ensure the file isn&apos;t corrupted &mdash; try opening it in the Rive Editor first</li>
      </ul>

      <h2>Configuration won&apos;t apply</h2>
      <ul>
        <li>Ensure you&apos;re writing valid JavaScript syntax (not JSON)</li>
        <li>Check the red error banner for syntax error details</li>
        <li>Errors auto-dismiss after 5 seconds; check the console for persistent errors</li>
      </ul>

      <h2>ViewModel controls missing</h2>
      <ul>
        <li>The animation must have ViewModelInstances defined in the Rive Editor</li>
        <li>Check that <code>autoBind: true</code> is set (default behavior)</li>
        <li>Try reloading the animation</li>
      </ul>

      <h2>Desktop build fails</h2>
      <ul>
        <li>Run <code>rustup update</code> to ensure latest Rust toolchain</li>
        <li>Check <code>npm run tauri info</code> for missing dependencies</li>
        <li>On macOS, verify Xcode Command Line Tools are installed</li>
      </ul>

      <h2>MCP not connecting</h2>
      <ul>
        <li>Open the MCP Setup dialog to verify the sidecar path and port</li>
        <li>Check that RAV is running and the MCP indicator shows connected (bright indigo)</li>
        <li>Verify the server is registered: <code>claude mcp list</code> or <code>codex mcp list</code></li>
        <li>The bridge auto-reconnects &mdash; if the client started after RAV, wait a few seconds</li>
        <li>Change the bridge port in the MCP Setup dialog if 9274 is occupied</li>
      </ul>

      <h2>Getting Help</h2>
      <p>
        If your issue isn&apos;t covered here,{" "}
        <a href="https://github.com/ivg-design/rive-animation-viewer/issues" target="_blank" rel="noopener noreferrer">
          open an issue on GitHub
        </a>{" "}
        with your OS version, RAV version, and the <code>.riv</code> file if possible.
      </p>
    </>
  );
}
