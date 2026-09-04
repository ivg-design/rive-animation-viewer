# Rive Animation Viewer

A local and desktop viewer for `.riv` files with runtime controls, JavaScript configuration editing, ViewModelInstance debugging tools, media and standalone export, a bundled native MCP sidecar, and desktop auto-update support.

For media export and recording, see [Media export and recording](Documentation/MEDIA_EXPORT.md). Release history belongs in the [changelog](CHANGELOG.md); validation evidence is kept in [reports](reports/).

## Release

- Current public release: `2.5.4` ([GitHub release](https://github.com/ivg-design/rive-animation-viewer/releases/tag/v2.5.4)).
- Prepared release candidate: `2.5.5`.
- macOS downloads and updater apps are Developer ID signed, notarized, and stapled; updater payloads retain their separate update signatures.

The candidate becomes public only after private staging, signed updater acceptance,
and promotion of the exact `chore(release): v2.5.5` commit on `main`.

## Regression Gates

The repo has explicit prebuild guards for the application, export, and window-chrome surfaces:

- `npm run check:architecture` enforces file-size and folder-shape budgets
- `npm run check:deps` enforces dependency-cruiser import boundaries
- `tests/smoke/ui-regressions.smoke.test.js` protects the shared scrollbar contract, custom window-chrome structure, Tauri window config, and exported demo chrome contract
- `tests/unit/ui/window-chrome.test.js` protects desktop window-control wiring and Tauri/non-Tauri behavior split
- `npm run test` runs the full Vitest suite before every package build
- `cargo check --manifest-path src-tauri/Cargo.toml` validates the native Tauri layer

These gates reduce regression risk, but they remain code and DOM contract tests. Packaged desktop behavior still requires native acceptance with a real `.riv` file.

## Quick Start

```bash
npm install
npm start  # Opens the browser DEV viewer at http://localhost:1420; MCP uses isolated port 9278
```

Browser preview and packaged DEV sessions may share port `9278`, but the bridge
always routes agent commands to the packaged desktop app while it is connected.
The browser remains a fallback only when no desktop RAV peer is present.

## Features

### Core Viewer
- **File Loading**: Open button plus drag/drop file loading for `.riv` files
- **Desktop Open With**: Double-click / open-with / single-instance handoff for `.riv` files
- **Runtime Selection**: Toggle between Canvas and WebGL2 renderers
- **Runtime Version Selection**: Pick runtime semver (`Latest (auto)`, the latest 4 concrete versions, or `Custom`) from Settings
- **Layout Options**: Fit and alignment are surfaced directly in the main toolbar next to playback controls
- **Background Color**: Color picker with `No BG` reset for transparent canvas backgrounds
- **Explicit Canvas Size**: Settings can pin the canvas to a specific width/height in pixels and optionally lock the aspect ratio
- **Playback Controls**: Play, pause, and reset/restart (reset restarts playback in place with autoplay and restores control values)
- **Autoplay on Open**: Fresh file opens, drag/drop loads, open-with events, and MCP file opens all autoplay by default
- **Event Console**: Source toggles (`Native`, `Rive User`, `UI`, `MCP`), text search, timestamps, newest-first ordering, and `FOLLOW`
- **Console Actions**: Shared outlined SVG buttons for `FOLLOW`, `COPY`, and `CLEAR` across Event Console and JavaScript Console
- **Artboard Switcher**: Auto-populating dropdowns for artboards and playback targets (state machines + animations), VM instance selector, reset-to-default button
- **Exact Playback Labels**: Playback dropdown labels preserve authored capitalization and formatting exactly as they appear in the Rive file
- **State Machine Detection**: Automatically detects and initializes available state machines
- **Auto Update Chip**: Desktop app checks for updates on launch and exposes `UPDATE <version>`, `UPDATING`, `RESTARTING`, or `UPDATE RETRY`

### Code Editor Panel
- **CodeMirror 6 Editor**: JavaScript syntax highlighting with One Dark theme
- **JavaScript Configuration**: Write JavaScript objects (NOT JSON) for Rive initialization
- **Live Source Indicator**: The `EDITOR` title block itself indicates the current live source. Neutral gray means internal wiring is live. Green pulsing state means the applied editor config is live.
- **Apply & Reload**: `APPLY` evaluates the current editor code, switches the live source to the editor, and refreshes the current view without throwing away the active artboard/playback state
- **Editor Canvas Sizing**: Applied editor configs can include a `canvasSize` block so the live runtime, snippets, and exports all use the same explicit pixel size
- **Internal Wiring Toggle**: You can switch back to internal RAV wiring without deleting editor content
- **Tab Support**: Tab inserts 2 spaces, Shift+Tab removes indentation
- **Error Display**: Shows errors in red banner when configuration fails
- **Resizable Panel**: Drag to resize panel to any width for comfortable editing
- **VM Explorer Injection**: Injects helper APIs for console-driven VM inspection and mutation

### JavaScript Console
- **Integrated JS Console**: Executable REPL panel styled to match RAV
- **Console Capture**: Captures `console.log/info/warn/error/debug` output from the running app/runtime
- **REPL Execution**: Execute live JavaScript against the active browser/runtime context
- **Shared Console UX**: Same transcript layout as the Event Console, with timestamps, newest-first ordering, filters/search, and `FOLLOW`
- **Unified Console Chrome**: Command, result, warning, error, and application log rows share the same timestamp-and-badge styling while keeping Eruda's native lazy object inspection
- **Visible Transcript Copy**: `COPY` serializes the currently visible JS console rows in the same order and with the same badges you see on screen
- **MCP Console Tools**: Open, close, read, and execute console commands remotely through MCP

**Important**: The editor accepts JavaScript code, not JSON. You can use JavaScript features like comments, trailing commas, and unquoted keys:

```javascript
{
  // This is a valid comment
  artboard: "MyArtboard",
  stateMachine: "StateMachine1",
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

RAV includes a built-in MCP (Model Context Protocol) sidecar that lets Claude Code, Claude Desktop, Codex, or any MCP client control the viewer remotely — open files, inspect ViewModels, drive playback, manipulate inputs, run JS, generate web snippets, export demos, and configure the workspace layout/state.

#### Architecture

An architecture budget enforces the runtime source structure:

- [ARCHITECTURE.md](ARCHITECTURE.md) defines module and folder rules
- [architecture-budget.json](architecture-budget.json) locks current oversized files so they cannot keep growing
- `.dependency-cruiser.cjs` enforces layer boundaries and cycle bans
- `npm run check:architecture` and `npm run check:deps` run automatically as part of `npm run test`

The key rule is simple: new hand-written source files may not exceed `400` lines, and folders must subgroup before they turn into flat dumping grounds.

```
MCP Client ←(stdio)→ rav-mcp sidecar ←(WebSocket :9274)→ RAV Frontend
```

The desktop app bundles one native `rav-mcp` sidecar beside the main application executable and exposes a stable launcher path for external clients. On macOS, the exact location is `Rive Animation Viewer.app/Contents/MacOS/rav-mcp`; RAV derives it from the running executable's parent directory. Tauri applies the same Developer ID, hardened-runtime, and timestamp requirements to the sidecar before signing the outer app. The frontend MCP bridge client starts automatically when RAV launches, attaches to the configured port, and keeps retrying until a client attaches.

#### Setup (one-time)

Open the desktop app, click the cable icon, and use the **MCP Setup** dialog:

- **Launcher path**: Copy the stable `rav-mcp-rav` launcher path generated for your machine
- **Client detection**: Detect whether Codex, Claude Code, and Claude Desktop are present and whether `rav-mcp` is already configured
- **One-click installs**: Add RAV to Codex, Claude Code, or Claude Desktop directly from the dialog when those clients are detected
- **Reinstall / remove**: Already-configured clients show `REINSTALL` and `REMOVE`
- **Responsive setup refresh**: The MCP dialog paints immediately, then hydrates install status in the background to avoid blocking the UI
- **Configurable port**: Change the MCP bridge port from inside the MCP dialog and all generated snippets update to match
- **Script Access**: Keep MCP in read-only mode, or explicitly allow JavaScript execution (`rav_eval`, `rav_console_exec`, `rav_apply_code`)
- **Copy/paste snippets**: Ready-to-paste snippets are shown for Codex, Claude Code, Claude Desktop, and a generic MCP client

Representative snippets:

```bash
claude mcp add-json -s user rav-mcp '{"type":"stdio","command":"/Users/you/.local/bin/rav-mcp-rav","args":["--stdio-only","--port","9274"]}'
```

```toml
[mcp_servers."rav-mcp"]
command = "/Users/you/.local/bin/rav-mcp-rav"
args = ["--stdio-only", "--port", "9274"]
```

Open the RAV desktop app and enable the MCP bridge. The **MCP** chip is muted and crossed out when disabled, yellow while connecting, red after a bridge failure, green when healthy and ready, and blue for 30 seconds after an agent command arrives. From then on, your MCP client can control RAV whenever both are running.

#### Available Tools (57)

| Tool | Description |
|------|-------------|
| `rav_status` | App status: file, runtime, playback, ViewModel summary |
| `rav_set_anonymous_usage` | Enable or disable anonymous version reporting through the Settings preference controller |
| `rav_open_file` | Open a .riv file by absolute path |
| `rav_play` / `rav_pause` / `rav_reset` | Playback controls |
| `rav_get_artboards` | List artboard names |
| `rav_get_state_machines` | List state machine names |
| `rav_switch_artboard` / `rav_reset_artboard` | Switch artboard/animation, reset to default |
| `rav_switch_vm_instance` | Bind a specific authored or runtime/list ViewModel instance key |
| `rav_get_vm_tree` | Full ViewModel hierarchy |
| `rav_vm_get` / `rav_vm_set` / `rav_vm_fire` | Read, write, and fire ViewModel properties |
| `rav_vm_set_image` / `rav_vm_clear_image` | Set or clear an image on the authoritative root ViewModel |
| `rav_get_global_vm_tree` | List every named file-level global ViewModel and its hierarchy |
| `rav_global_vm_get` / `rav_global_vm_set` / `rav_global_vm_fire` | Read, write, or fire a property in a specifically named global ViewModel |
| `rav_global_vm_set_image` / `rav_global_vm_clear_image` | Set or clear a named global ViewModel image through authoritative playback |
| `rav_get_event_log` | Recent event log entries (filterable by source) |
| `rav_get_editor_code` / `rav_set_editor_code` | Read/write the script editor |
| `rav_apply_code` | Apply editor code and reload animation (`Script Access` required) |
| `rav_set_runtime` | Switch runtime (webgl2/canvas) |
| `rav_set_layout` / `rav_set_alignment` | Set layout fit mode and nine-way canvas alignment |
| `rav_set_canvas_color` | Set background color or transparent |
| `rav_set_canvas_size` | Set canvas sizing mode (`auto` or explicit pixels) and optional aspect lock |
| `rav_capture_canvas` | Capture the authoritative rendered canvas as PNG image content with render metadata |
| `rav_media_capabilities` | Inspect verified media encoders, formats, transparency support, limits, and production distribution state |
| `rav_export_media` | Export a complete/segmented timeline or a current/timed still as an asynchronous desktop job |
| `rav_record_start` / `rav_record_stop` | Record live state-machine interaction manually or for a duration, with optional cursor and scheduled interactions |
| `rav_media_status` / `rav_media_cancel` | Poll capture/encoding/verification progress or cancel an active media job |
| `rav_step_frames` / `rav_pointer` | Advance exact frames and send normalized pointer input for agent-controlled playback and recording |
| `rav_open_isolated_playback` | Open the current animation in an ordinary isolated diagnostic WebView |
| `rav_export_demo` | Export standalone HTML demo |
| `rav_export_demo_visual` | Drive the visible export dialog with exact control selection, package source, snippet mode, and output path |
| `generate_web_instantiation_code` | Generate the canonical live web-instantiation snippet (`local` npm package or `cdn`) with selected typed accessors on `window.riveProperties`. Preferred over hand-writing snippets from scratch. |
| `rav_toggle_instantiation_controls_dialog` | Open/close the in-app Snippet & Export Controls dialog so a human can choose which controls are serialized |
| `rav_configure_workspace` | Open/close sidebars, switch live source mode (`internal` / `editor`), and inject/remove the VM Explorer snippet idempotently |
| `rav_get_sm_inputs` / `rav_set_sm_input` | State machine input access |
| `rav_eval` | Evaluate JS with `target: auto|host|playback`, returning the resolved surface/session (`Script Access` required) |
| `rav_console_open` / `rav_console_close` | Toggle the JS console remotely |
| `rav_console_set_mode` / `rav_console_set_filter` / `rav_console_clear` | Switch console mode, mirror visible filters, and clear the active transcript |
| `rav_console_read` / `rav_console_exec` | Read the JS console transcript or run REPL code (`rav_console_exec` requires `Script Access`). Transcript includes REPL input/result rows plus captured `console.*` output. |

#### Editor and Export Semantics

- `rav_eval` defaults to the active authoritative playback child and otherwise uses the host WebView. Set `target: "playback"` to require the child or `target: "host"` for a deliberate UI-WebView diagnostic; results identify the resolved surface and child session.
- The console tools read and execute only in the host UI WebView. They do not forward isolated-child `console.*` calls or claim live Luau-output authority.
- The live runtime can run in either internal mode or editor-driven mode.
- `rav_apply_code` switches the live runtime to the last applied editor config.
- Unsaved editor draft changes do not change the running animation until applied.
- `rav_status` reports the active instantiation source and whether the editor draft is dirty.
- `rav_status` also reports the active canvas sizing mode and explicit pixel size when the canvas is fixed.
- ViewModel paths are slash-separated. Dynamic list items use a zero-based live index such as `rows/0/playerName`; call `rav_get_vm_tree` again after the controlling count changes before addressing newly added or removed rows.
- Global ViewModel tools require both the file-level ViewModel name and its property path, preventing collisions when multiple globals expose the same path.
- `generate_web_instantiation_code` always reflects what is actually running.
- `generate_web_instantiation_code` defaults to the CDN form unless you explicitly request `package_source: "local"`.
- Compact snippets expose only checked ViewModel/state-machine accessors on `window.riveProperties`; scaffold snippets list all accessors with unchecked lines commented out. They do not replay captured values.
- Fixed-size snippets and exported demos preserve explicit `width × height` sizing instead of collapsing back to host-driven layout.
- The **Snippet & Export Controls** dialog chooses which accessors appear in snippets and which current values a standalone HTML export restores. Branch checkboxes select nested properties; individual rows affect one property only.
- If you never open the dialog, RAV defaults to the controls that differ from the load-time baseline.
- Exported demos mirror the active live source, keep fit/alignment in the main toolbar, and include a **Copy Instantiation Code** button in the demo toolbar.

#### Event Console

All MCP commands, responses, and connection events appear in the event console with the `MCP` source tag. Messages are formatted as human-readable summaries with elapsed time — no raw JSON. Use the `MCP` filter toggle to show/hide MCP traffic.

#### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RAV_MCP_PORT` | `9274` | WebSocket bridge port |

### Desktop Features (Tauri)
- **Native App**: Runs as a desktop application on macOS/Windows/Linux
- **Demo Bundle Export**: Create self-contained HTML files with embedded animations and copyable instantiation snippets
- **Canvas Background Parity**: Exported demos preserve the selected solid or transparent canvas background
- **Offline Support**: Caches runtime scripts for offline use
- **Dev Tools Access**: Programmatic DevTools opening via inject button to access console
- **Background App Updates**: Check, authenticate with the Tauri updater signature, install, and relaunch updates from GitHub Releases
- **Safe Updater Bridge Shutdown**: Desktop installs stop the app-owned MCP bridge before updater installation starts, preventing Windows file-lock stalls
- **Trusted macOS distribution**: Developer ID signing, notarization, stapling, and parity checks cover both direct-download DMGs and macOS updater apps
- **Merged updater publishing**: Release automation publishes a combined `latest.json` only after macOS Apple Silicon, macOS Intel, MSI, and NSIS updater payloads are all present

## Project Structure

```
rive-local/
├── index.html                # Main UI shell
├── styles/                   # Split UI stylesheets
├── mcp-server/
│   ├── index.js              # Reference JS MCP server
│   └── README.md             # MCP protocol/setup guide
├── src/app/
│   ├── main-entry.js         # Frontend composition root / bootstrap
│   ├── bootstrap/            # App wiring stacks
│   ├── core/                 # Constants + DOM element registry
│   ├── platform/             # Runtime, export, updater, session, MCP helpers
│   ├── rive/                 # Instance, playback, VM, artboard controllers
│   ├── snippets/             # Source-backed and generated injected snippets
│   └── ui/                   # Editor, consoles, dialogs, shell/status controllers
├── vendor/
│   └── codemirror-bundle.js  # Bundled CodeMirror
├── scripts/
│   ├── build-dist.mjs        # Production build
│   ├── build-mcp-sidecar.mjs # Debug rav-mcp builder used before tauri dev
│   ├── check-release-version.mjs # Verifies synchronized release metadata
│   ├── generate-updater-manifest.mjs # Merges complete multi-platform updater assets
│   ├── verify-macos-distribution.sh # Verifies Developer ID/notary parity
│   └── verify-updater-signatures.mjs # Verifies exact Tauri-signed payload bytes
└── src-tauri/                # Rust/Tauri desktop wrapper + native rav-mcp
```

## Desktop Development

### Prerequisites
- Rust toolchain (`rustup`)
- Node.js 22.13+ (the release pipeline is pinned to Node.js 24.20.0)
- Xcode Command Line Tools (macOS)

### Build Commands
```bash
npm run tauri dev   # Development mode
npm run tauri build # Production build
```

Export behavior must be tested in a packaged desktop build. The web build
deliberately disables or cannot provide the native export path, so browser-only
testing cannot accept an export change. Keep the exported artifact and identify
the exact packaged build in the test receipt.

### Test Build Numbering

`npm run build` stamps builds as `bNNNN-YYYYMMDD-HHMM-<gitsha>`:
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
  stateMachine: "State Machine 1",
  autoplay: true,
  canvasSize: {
    mode: "fixed",
    width: 1600,
    height: 900,
    lockAspectRatio: true,
  },
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

### Runtime API compatibility

Use `stateMachine: "name"` for one state machine. RAV accepts both this spelling and existing `stateMachines` configurations, then chooses the runtime API for the loaded version: singular on Rive 2.41+, plural on older runtimes. Standalone demos and generated snippets use the same version boundary. For LOCAL snippets, install the runtime version reported with the snippet so the emitted API matches your package.

Explicit timeline playback, multiple simultaneous state machines, legacy state-machine inputs, and user-supplied event callbacks remain supported. These can still emit upstream deprecation warnings on 2.41+. The active viewer/demo also retains StateChange and RiveEvent listeners for its event log; generated snippets do not subscribe unless user code requests them. RAV does not rewrite authored state machines or bindings inside a compiled `.riv` file, and it does not suppress runtime warnings.

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
- Loaded from the source-backed snippet pipeline under `src/app/snippets/source/vm-explorer.js` and emitted into the generated snippet bundle at build time
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
