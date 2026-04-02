# Rive Animation Viewer

A local and desktop viewer for `.riv` files with runtime controls, JavaScript configuration editing, and ViewModelInstance debugging tools.

## Release

- Current release: `1.9.9` (2026-04-01)

## Quick Start

```bash
npm install
npm start  # Opens browser at http://localhost:1420
```

## Features

### Core Viewer
- **File Loading**: Open button plus drag/drop file loading for `.riv` files
- **Runtime Selection**: Toggle between Canvas and WebGL2 renderers
- **Runtime Version Selection**: Pick runtime semver (`Latest (auto)`, pinned versions, or `Custom`) from Settings
- **Layout Options**: Choose from contain, cover, fill, fit-width, fit-height, scale-down, scale-up
- **Background Color**: Color picker with `No BG` reset for transparent canvas backgrounds
- **Transparency Mode**: Toggle transparent canvas/window mode for overlay-style playback
- **Click-through (Desktop)**: Cursor-synced transparent-pixel click-through while keeping the viewer topmost in transparency mode
- **Playback Controls**: Play, pause, and reset/restart (reset reloads animation with autoplay and restores control values)
- **Event Console**: Source toggles (`Native`, `Rive User`, `UI`, `MCP`) and text search filters
- **Artboard Switcher**: Auto-populating dropdowns for artboards and playback targets (state machines + animations), VM instance selector, reset-to-default button
- **State Machine Detection**: Automatically detects and initializes available state machines

### Code Editor Panel
- **CodeMirror 6 Editor**: JavaScript syntax highlighting with One Dark theme
- **JavaScript Configuration**: Write JavaScript objects (NOT JSON) for Rive initialization
- **Live Source Mode Chip**: The editor header always shows whether the running animation is using RAV's `INTERNAL` wiring or the last applied `EDITOR` config
- **Apply & Reload**: Applies the current editor code, switches the live source to `EDITOR`, and refreshes the current view without throwing away the active artboard/playback state
- **Internal Wiring Toggle**: Click the live source chip to switch back to RAV's internal wiring instantly
- **Tab Support**: Tab inserts 2 spaces, Shift+Tab removes indentation
- **Error Display**: Shows errors in red banner when configuration fails
- **Resizable Panel**: Drag to resize panel to any width for comfortable editing

### JavaScript Console
- **Integrated JS Console**: Executable REPL panel styled to match RAV
- **Console Capture**: Captures `console.log/info/warn/error/debug` output from the running app/runtime
- **REPL Execution**: Execute live JavaScript against the active browser/runtime context
- **MCP Console Tools**: Open, close, read, and execute console commands remotely through MCP

**Important**: The editor accepts JavaScript code, not JSON. You can use JavaScript features like comments, trailing commas, and unquoted keys:

```javascript
{
  // This is a valid comment
  artboard: "MyArtboard",
  stateMachines: ["StateMachine1"],
  autoplay: true,
}
```

### ViewModelInstance Explorer
Developer tool for debugging Rive files with ViewModelInstances.

#### How to Use
1. Load a Rive file
2. Click "Inject VM Explorer" button in toolbar
3. Open browser console (F12 or Cmd+Option+I)
4. Use the following commands:

```javascript
vmExplore()                  // Show root properties
vmExplore("path/to/prop")    // Navigate to specific path
vmGet("settings/volume")     // Get value
vmSet("settings/volume", 0.5) // Set value
vmTree                       // View full hierarchy
vmPaths                      // List all property paths
```

The explorer displays a comprehensive usage guide in the console when injected.

### MCP Integration

RAV includes a built-in MCP (Model Context Protocol) sidecar that lets Claude Code, Claude Desktop, Codex, or any MCP client control the viewer remotely — open files, inspect ViewModels, drive playback, manipulate inputs, run JS, generate web snippets, and export demos.

#### Architecture

```
MCP Client ←(stdio)→ rav-mcp sidecar ←(WebSocket :9274)→ RAV Frontend
```

The desktop app bundles a native `rav-mcp` sidecar binary inside the app resources. The frontend bridge (`mcp-bridge.js`) auto-connects when RAV starts and reconnects with exponential backoff.

#### Setup (one-time)

Open the desktop app, click the cable icon, and use the **MCP Setup** dialog:

- **Bundled sidecar path**: Copy the exact `rav-mcp` binary path shipped inside the app bundle
- **One-click installs**: Add RAV to Codex, Claude Code, or Claude Desktop directly from the dialog when those clients are detected
- **Copy/paste snippets**: Ready-to-paste snippets are shown for Codex, Claude Code, Claude Desktop, and a generic MCP client

Representative snippets:

```bash
claude mcp add-json -s user rav-mcp '{"type":"stdio","command":"/Applications/Rive Animation Viewer.app/Contents/Resources/resources/rav-mcp","args":[]}'
```

```toml
[mcp_servers."rav-mcp"]
command = "/Applications/Rive Animation Viewer.app/Contents/Resources/resources/rav-mcp"
args = []
```

Open the RAV desktop app and enable the MCP bridge — the **MCP** indicator in the runtime strip brightens when connected. From then on, your MCP client can control RAV whenever both are running.

#### Available Tools (28)

| Tool | Description |
|------|-------------|
| `rav_status` | App status: file, runtime, playback, ViewModel summary |
| `rav_open_file` | Open a .riv file by absolute path |
| `rav_play` / `rav_pause` / `rav_reset` | Playback controls |
| `rav_get_artboards` | List artboard names |
| `rav_get_state_machines` | List state machine names |
| `rav_switch_artboard` / `rav_reset_artboard` | Switch artboard/animation, reset to default |
| `rav_get_vm_tree` | Full ViewModel hierarchy |
| `rav_vm_get` / `rav_vm_set` / `rav_vm_fire` | Read, write, and fire ViewModel properties |
| `rav_get_event_log` | Recent event log entries (filterable by source) |
| `rav_get_editor_code` / `rav_set_editor_code` | Read/write the script editor |
| `rav_apply_code` | Apply editor code and reload animation |
| `rav_set_runtime` | Switch runtime (webgl2/canvas) |
| `rav_set_layout` | Set layout fit mode |
| `rav_set_canvas_color` | Set background color or transparent |
| `rav_export_demo` | Export standalone HTML demo |
| `generate_web_instantiation_code` | Generate the canonical live web-instantiation snippet (`local` npm package or `cdn`) with `window.ravRive` helpers and current control values |
| `rav_toggle_instantiation_controls_dialog` | Open/close the in-app Snippet & Export Controls dialog so a human can choose which controls are serialized |
| `rav_get_sm_inputs` / `rav_set_sm_input` | State machine input access |
| `rav_eval` | Evaluate JS in RAV's browser context |
| `rav_console_open` / `rav_console_close` | Toggle the JS console remotely |
| `rav_console_read` / `rav_console_exec` | Read captured console output or run REPL code |

#### Editor and Export Semantics

- The live runtime can run in either `INTERNAL` mode or `EDITOR` mode.
- `rav_apply_code` switches the live runtime to the last applied editor config.
- Unsaved editor draft changes do not change the running animation until applied.
- `rav_status` reports the active instantiation source and whether the editor draft is dirty.
- `generate_web_instantiation_code` always reflects what is actually running.
- `generate_web_instantiation_code` defaults to the CDN form unless you explicitly request `package_source: "local"`.
- Generated snippets restore the checked ViewModel/state-machine values on load and expose helper methods on `window.ravRive`.
- The **Snippet & Export Controls** dialog lets you choose exactly which controls are serialized. Branch checkboxes select nested controls; individual rows affect one value only.
- If you never open the dialog, RAV defaults to serializing only the controls that differ from the load-time baseline.
- Exported demos mirror the active live source, keep fit/alignment in the main toolbar, and include a **Copy Instantiation Code** button in the demo toolbar.

#### Event Console

All MCP commands, responses, and connection events appear in the event console with the `MCP` source tag (indigo). Messages are formatted as human-readable summaries with elapsed time — no raw JSON. Use the `MCP` filter toggle to show/hide MCP traffic.

#### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RAV_MCP_PORT` | `9274` | WebSocket bridge port |
| `RAV_MCP_TIMEOUT` | `15000` | Command timeout in ms |

### Desktop Features (Tauri)
- **Native App**: Runs as a desktop application on macOS/Windows/Linux
- **Demo Bundle Export**: Create self-contained HTML files with embedded animations
- **Demo Runtime Guardrails**: Exported demos intentionally disable desktop-only transparency toggle behavior
- **Offline Support**: Caches runtime scripts for offline use
- **Dev Tools Access**: Programmatic DevTools opening via inject button to access console

## Project Structure

```
rive-local/
├── app.js                    # Main application logic
├── mcp-bridge.js            # MCP WebSocket bridge client (frontend)
├── vm-explorer-snippet.js   # ViewModelInstance explorer tool
├── index.html               # Main UI
├── style.css                # Styles
├── mcp-server/
│   ├── index.js             # Reference JS MCP server
│   ├── package.json         # JS MCP server dependencies
│   └── README.md            # MCP protocol/setup guide
├── vendor/
│   └── codemirror-bundle.js # Bundled CodeMirror
├── scripts/
│   ├── build-dist.mjs       # Production build
│   ├── bundle-codemirror.mjs # CodeMirror bundler
│   └── build-mcp-sidecar.mjs # Native rav-mcp sidecar builder
└── src-tauri/               # Rust/Tauri desktop wrapper
```

## Desktop Development

### Prerequisites
- Rust toolchain (`rustup`)
- Node.js 18+
- Xcode Command Line Tools (macOS)

### Build Commands
```bash
npm run tauri dev   # Development mode
npm run tauri build # Production build
```

### Test Build Numbering

`npm run build` now stamps builds as `bNNNN-YYYYMMDD-HHMM-<gitsha>`:
- `bNNNN` auto-increments on every local build via `.cache/build-counter.txt`
- Timestamp uses local system time
- Tail is short git SHA

Override the test build number when needed:

```bash
npm run build -- --build-number=172
APP_BUILD_NUMBER=172 npm run tauri build
```

## Technical Details

### Configuration Format
The editor uses `eval()` to evaluate JavaScript code, allowing full JavaScript syntax:

```javascript
{
  artboard: "Main",
  stateMachines: ["State Machine 1"],
  autoplay: true,
  layout: {
    fit: "contain",
    alignment: "center"
  },
  // Custom onLoad callback
  onLoad: () => {
    console.log("Animation loaded!");
    riveInst.resizeDrawingSurfaceToCanvas();
  }
}
```

### Error Handling
- Configuration errors display in a red error banner
- Errors auto-dismiss after 5 seconds
- Invalid JavaScript shows syntax errors
- File loading errors display detailed messages

### Tab Key Implementation
The editor intercepts Tab key events when focused:
- Captures keydown events in capture phase
- Prevents default browser tab behavior
- Manually inserts/removes spaces at cursor position

### VM Explorer Architecture
- Loaded as external module from `vm-explorer-snippet.js` (contains only functional code)
- Usage guide displayed when injecting, not in the snippet itself
- Walks ViewModelInstance property trees recursively
- Builds path references for direct access
- Uses Rive runtime's path resolution for get/set operations

## Known Issues

### CSP Warnings (Desktop)
The desktop app shows harmless CSP warnings about `blob://` URLs. These are WebKit quirks and don't affect functionality.

### DMG Creation
DMG bundling may fail on some systems. The `.app` bundle in `src-tauri/target/release/bundle/macos/` works regardless.

### Tab Key
Tab indentation only works when the editor has focus. Click in the editor area before using Tab.

## Troubleshooting

**Animation won't load**
- Check browser console for errors
- Verify the .riv file is valid
- Try a different runtime (Canvas vs WebGL2)

**Configuration won't apply**
- Ensure you're writing valid JavaScript (not JSON)
- Check for syntax errors in the code
- Look for error messages in the red banner

**VM Explorer not working**
- Verify your Rive file has ViewModelInstances
- Check console for injection confirmation
- Try reloading after injection

**Desktop build fails**
- Run `rustup update` to ensure latest Rust
- Check `npm run tauri info` for missing dependencies
- Verify Xcode Command Line Tools installed (macOS)

## License

MIT License - Copyright © 2025 IVG Design

Rive runtimes are provided by [Rive](https://rive.app/) under their own licensing terms.
