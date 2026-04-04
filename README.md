# Rive Animation Viewer

A local and desktop viewer for `.riv` files with runtime controls, JavaScript configuration editing, ViewModelInstance debugging tools, standalone export, a bundled native MCP sidecar, and desktop auto-update support.

## Release

- Current release: `2.1.0` (2026-04-04)
- Latest minor: `2.1.0` ships the full architecture refactor, custom desktop About window, console/header polish, MCP/runtime strip fixes, and Windows shell cleanup in one release.
- Validation target: release from `main` so installed desktop builds can pick up the `2.1.0` updater payload directly.

## 2.1.0 Highlights

- **Architecture sweep**: Root runtime drift is gone. App boot now starts from `src/app/main-entry.js`, the frontend MCP bridge lives under `src/app/platform/mcp`, injected snippets are source-backed, and architecture rules now enforce modular growth.
- **Custom desktop About**: RAV now ships a proper in-app About window with runtime/build metadata, credits, dependency inventory, product links, and native Help-menu integration.
- **Console mode cleanup**: The runtime strip console control is now open/close only, the console header toggles `Events` / `JS`, and JS `FOLLOW` now tracks the real visible transcript correctly.
- **Indicator and logging fixes**: Runtime and MCP status chips again reflect the real live state, and cyclic MCP payloads no longer crash the event console renderer.
- **Windows polish**: Dark-mode menu chrome remains visible and the bundled MCP sidecar no longer opens a stray PowerShell window on launch.

## 2.0.5 Highlights

- **Windows release fix**: The stable MCP launcher-path helper now compiles on Windows, fixing the cross-platform release failure that blocked the `2.0.4` tag from publishing a complete updater set.

## 2.0.4 Highlights

- **Claude-ready native sidecar**: `rav-mcp` now speaks both normal MCP `Content-Length` framing and Claude's newline-delimited JSON probe format, so Claude health checks no longer fail before the first real tool call.
- **Real MCP-ready startup**: Packaged builds now load the frontend bridge correctly on launch, so `MCP ready` actually corresponds to a live RAV app bridge and not just a listening sidecar process.
- **Stable launcher path**: MCP client setup now targets a stable launcher path (`rav-mcp-rav`) instead of the app-bundle-internal binary, which survives app replacements and keeps Claude/Codex registrations valid.
- **Workspace control tool**: Agents can now call `rav_configure_workspace` to open/close sidebars, switch between internal/editor live source modes, and inject/remove the VM Explorer snippet.
- **Updater retry self-heal**: `UPDATE RETRY` no longer waits for a manual click forever; the app retries checks automatically on focus, visibility return, online events, and a short timer.

## 2.0.3 Highlights

- **Consistent JS console chrome**: Command, result, warning, error, and app log rows now share the same timestamp-and-badge presentation instead of mixing Eruda chevrons with plain text tags.
- **Working JS console filters**: Level/search filters now act on the actual visible transcript, so REPL input/output rows no longer punch through warning/error filters.
- **Copy mirrors the screen**: The JS console copy action now copies the current visible transcript exactly as shown, in newest-first order.
- **Native object inspection preserved**: `riveInst` and other live objects still use Eruda's lazy inspector instead of being collapsed into fake summary objects.
- **Docs/site sync**: README, docs, changelog, and feature cards now explicitly describe the normalized console behavior.

## 2.0.2 Highlights

- **Exact playback names**: State machine and animation names are shown exactly as authored in the `.riv` file, without injected display prefixes.
- **Refined startup layout**: RAV now opens with the right properties panel visible while the editor and console stay closed by default.
- **Icon-based console actions**: Event and JS consoles now use outlined SVG controls for `FOLLOW`, `COPY`, and `CLEAR`, with clearer active-state styling.
- **Primary toolbar polish**: `OPEN` stays bright green, auto-fits its icon-plus-label width, and the runtime renderer selector now lives with the main playback/layout controls.
- **MCP setup responsiveness**: The MCP dialog opens immediately and refreshes install-state data asynchronously instead of blocking the UI.
- **Release workflow compatibility**: The release pipeline now points at the real published `tauri-action` tag and uses Node 24-compatible JavaScript action settings for future releases.

## 2.0.0 Highlights

- **Bundled native MCP sidecar**: Packaged builds no longer require Node.js to expose MCP. RAV ships with a native `rav-mcp` binary and an always-on bridge.
- **One-click MCP setup**: The MCP dialog detects Codex, Claude Code, and Claude Desktop, shows whether `rav-mcp` is already configured, and offers `ADD`, `REINSTALL`, and `REMOVE`.
- **Script Access permission**: MCP scripting tools are gated behind an explicit `Script Access` toggle so you can keep MCP in read-only control mode when needed.
- **Snippet & Export Controls**: `EXPORT` opens a dialog that previews the generated web snippet, lets you choose CDN vs local package output, and serializes only the selected or changed controls.
- **Readable integration snippets**: Generated snippets are organized for real integration use, round numbers to 2 decimals, annotate enum choices inline, and expose a `window.ravRive` helper API.
- **Unified consoles**: Event Console and JavaScript Console now share the same newest-first transcript model, timestamps, search/filter workflow, and `FOLLOW` behavior.
- **Live-source-aware editor**: The editor title itself indicates whether the live runtime is being driven by internal RAV wiring or the applied editor config.
- **Background app updates**: The desktop app checks for signed updates on launch and exposes an update chip for install/relaunch flow.
- **Cross-architecture updater feed**: Signed release feeds now publish Apple Silicon, Intel macOS, and Windows updater entries together so one release can serve all supported desktop targets.

## Quick Start

```bash
npm install
npm start  # Opens browser at http://localhost:1420
```

## Features

### Core Viewer
- **File Loading**: Open button plus drag/drop file loading for `.riv` files
- **Desktop Open With**: Double-click / open-with / single-instance handoff for `.riv` files
- **Runtime Selection**: Toggle between Canvas and WebGL2 renderers
- **Runtime Version Selection**: Pick runtime semver (`Latest (auto)`, the latest 4 concrete versions, or `Custom`) from Settings
- **Layout Options**: Fit and alignment are surfaced directly in the main toolbar next to playback controls
- **Background Color**: Color picker with `No BG` reset for transparent canvas backgrounds
- **Transparency Mode**: Toggle transparent canvas/window mode for overlay-style playback
- **Click-through (Desktop)**: Cursor-synced transparent-pixel click-through while keeping the viewer topmost in transparency mode
- **Playback Controls**: Play, pause, and reset/restart (reset reloads animation with autoplay and restores control values)
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

RAV includes a built-in MCP (Model Context Protocol) sidecar that lets Claude Code, Claude Desktop, Codex, or any MCP client control the viewer remotely — open files, inspect ViewModels, drive playback, manipulate inputs, run JS, generate web snippets, export demos, and configure the workspace layout/state.

#### Architecture

Runtime source structure is now enforced by an architecture budget:

- [ARCHITECTURE.md](/Users/ivg/github/rive-animation-viewer-audit-20260401/ARCHITECTURE.md) defines module and folder rules
- [architecture-budget.json](/Users/ivg/github/rive-animation-viewer-audit-20260401/architecture-budget.json) locks current oversized files so they cannot keep growing
- `.dependency-cruiser.cjs` enforces layer boundaries and cycle bans
- `npm run check:architecture` and `npm run check:deps` run automatically as part of `npm run test`

The key rule is simple: new hand-written source files may not exceed `400` lines, and folders must subgroup before they turn into flat dumping grounds.

```
MCP Client ←(stdio)→ rav-mcp sidecar ←(WebSocket :9274)→ RAV Frontend
```

The desktop app bundles a native `rav-mcp` sidecar binary inside the app resources and exposes a stable launcher path for external clients. The frontend MCP bridge client starts automatically when RAV launches, attaches to the configured port, and keeps retrying until a client attaches.

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

Open the RAV desktop app and enable the MCP bridge — the **MCP** indicator in the runtime strip brightens when connected. From then on, your MCP client can control RAV whenever both are running.

#### Available Tools (31)

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
| `rav_apply_code` | Apply editor code and reload animation (`Script Access` required) |
| `rav_set_runtime` | Switch runtime (webgl2/canvas) |
| `rav_set_layout` | Set layout fit mode |
| `rav_set_canvas_color` | Set background color or transparent |
| `rav_export_demo` | Export standalone HTML demo |
| `generate_web_instantiation_code` | Generate the canonical live web-instantiation snippet (`local` npm package or `cdn`) with `window.ravRive` helpers and current control values |
| `rav_toggle_instantiation_controls_dialog` | Open/close the in-app Snippet & Export Controls dialog so a human can choose which controls are serialized |
| `rav_configure_workspace` | Open/close sidebars, switch live source mode (`internal` / `editor`), and inject/remove the VM Explorer snippet idempotently |
| `rav_get_sm_inputs` / `rav_set_sm_input` | State machine input access |
| `rav_eval` | Evaluate JS in RAV's browser context (`Script Access` required) |
| `rav_console_open` / `rav_console_close` | Toggle the JS console remotely |
| `rav_console_read` / `rav_console_exec` | Read captured console output or run REPL code (`rav_console_exec` requires `Script Access`) |

#### Editor and Export Semantics

- The live runtime can run in either internal mode or editor-driven mode.
- `rav_apply_code` switches the live runtime to the last applied editor config.
- Unsaved editor draft changes do not change the running animation until applied.
- `rav_status` reports the active instantiation source and whether the editor draft is dirty.
- `generate_web_instantiation_code` always reflects what is actually running.
- `generate_web_instantiation_code` defaults to the CDN form unless you explicitly request `package_source: "local"`.
- Generated snippets restore only the checked ViewModel/state-machine values on load, round numbers to 2 decimals, annotate enum choices inline, and expose helper methods on `window.ravRive`.
- The **Snippet & Export Controls** dialog lets you choose exactly which controls are serialized. Branch checkboxes select nested controls; individual rows affect one value only and branch expansion stays open while you curate nested values.
- If you never open the dialog, RAV defaults to serializing only the controls that differ from the load-time baseline.
- Exported demos mirror the active live source, keep fit/alignment in the main toolbar, and include a **Copy Instantiation Code** button in the demo toolbar.

#### Event Console

All MCP commands, responses, and connection events appear in the event console with the `MCP` source tag (indigo). Messages are formatted as human-readable summaries with elapsed time — no raw JSON. Use the `MCP` filter toggle to show/hide MCP traffic.

#### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RAV_MCP_PORT` | `9274` | WebSocket bridge port |

### Desktop Features (Tauri)
- **Native App**: Runs as a desktop application on macOS/Windows/Linux
- **Demo Bundle Export**: Create self-contained HTML files with embedded animations and copyable instantiation snippets
- **Demo Runtime Guardrails**: Exported demos intentionally disable desktop-only transparency toggle behavior
- **Offline Support**: Caches runtime scripts for offline use
- **Dev Tools Access**: Programmatic DevTools opening via inject button to access console
- **Background App Updates**: Check, download, install, and relaunch signed updates from GitHub Releases
- **Merged updater publishing**: Release automation now rebuilds a combined `latest.json` so macOS Apple Silicon, macOS Intel, and Windows updater payloads all stay present in the same feed

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
│   ├── build-mcp-sidecar.mjs # Native rav-mcp sidecar builder
│   └── generate-updater-manifest.mjs # Merges multi-platform updater assets into one latest.json
└── src-tauri/                # Rust/Tauri desktop wrapper + native rav-mcp
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
- Loaded as external module from `src/app/snippets/vm-explorer-snippet.js` (contains only functional code)
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
