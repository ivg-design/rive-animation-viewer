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
        <li>Ensure the file isn&apos;t corrupted &mdash; re-export it from the source project or obtain a fresh <code>.riv</code> export</li>
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
        <li>Use <code>autoBind: true</code> to bind the default instance automatically, or choose an explicit instance from the VM Instance selector</li>
        <li>The selector stays populated for a single default or unnamed instance; if it is empty, reload the file and inspect the event console</li>
        <li>Try reloading the animation</li>
      </ul>

      <h2>Nested images are displaced</h2>
      <ul>
        <li>Check the runtime version in the bottom strip or Settings</li>
        <li>Web 2.40.0 / runtime-v0.1.271 has a confirmed nested, data-bound image double-offset in both Canvas and WebGL2</li>
        <li>Latest (auto) is the default. If a particular runtime shifts authored positions, pin 2.39.2; the known 2.40.0 layout risk remains labeled</li>
      </ul>

      <h2>The Finder icon did not change</h2>
      <ul>
        <li>The current UTI and icon declarations require the signed installed app to replace the older bundle and launch once</li>
        <li>Use Finder&apos;s Open With menu to select Rive Animation Viewer for <code>.riv</code> files</li>
        <li>Finder and Launch Services may retain cached document artwork until the app has launched and the folder is reopened</li>
      </ul>

      <h2>The Windows .riv icon did not change</h2>
      <ul>
        <li>Older Windows installs may point <code>Rive File\DefaultIcon</code> at the application executable instead of the dedicated document icon</li>
        <li>Current releases bundle <code>RiveFileIcon.ico</code>, rewrite that value during NSIS install/update, and notify Explorer</li>
        <li>Verify the installed icon path exists before clearing Explorer&apos;s icon cache</li>
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
        <li>Check the MCP indicator: green means ready, blue means a command arrived recently, yellow means connecting, red means an error, and muted means disabled</li>
        <li>Verify the server is registered: <code>claude mcp list</code> or <code>codex mcp list</code></li>
        <li>The bridge auto-reconnects &mdash; if the client started after RAV, wait a few seconds</li>
        <li>Change the bridge port in the MCP Setup dialog if 9274 is occupied</li>
        <li>If RAV 2.4.1 reports that the bundled sidecar is missing, update to 2.4.2 or later; reinstalling 2.4.1 does not repair its path-resolution regression</li>
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
