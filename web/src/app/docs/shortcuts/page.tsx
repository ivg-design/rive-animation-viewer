export const metadata = { title: "Keyboard Shortcuts" };

export default function Shortcuts() {
  return (
    <>
      <h1>Keyboard Shortcuts</h1>

      <p>
        RAV is primarily a pointer-driven desktop tool. The current build does not ship
        global playback shortcuts. Available keybindings are contextual:
      </p>

      <table>
        <thead><tr><th>Shortcut</th><th>Context</th><th>Action</th></tr></thead>
        <tbody>
          <tr><td><code>Tab</code></td><td>Code editor</td><td>Indent by 2 spaces</td></tr>
          <tr><td><code>Shift+Tab</code></td><td>Code editor</td><td>Outdent by 2 spaces</td></tr>
          <tr><td><code>Enter</code></td><td>JS Console REPL</td><td>Execute the current command</td></tr>
          <tr><td><code>Shift+Enter</code></td><td>JS Console REPL</td><td>Insert a new line (multiline input)</td></tr>
          <tr><td><code>Arrow Up</code></td><td>JS Console REPL</td><td>Previous command from history</td></tr>
          <tr><td><code>Arrow Down</code></td><td>JS Console REPL</td><td>Next command in history</td></tr>
          <tr><td><code>Enter</code></td><td>Runtime version field</td><td>Apply the custom semver</td></tr>
          <tr><td><code>Enter</code></td><td>MCP port field</td><td>Apply the typed port</td></tr>
          <tr><td><code>Escape</code></td><td>Settings popover</td><td>Close the popover</td></tr>
        </tbody>
      </table>
    </>
  );
}
