# RAV MCP Server

Reference JavaScript MCP server for Rive Animation Viewer.

The desktop app now ships with a bundled native `rav-mcp` sidecar, and that is
the recommended setup path for end users. This folder remains useful for local
development, debugging, and understanding the protocol/tool surface in source
form.

## Architecture

```
MCP Client <--(stdio)--> MCP Server <--(WebSocket :9274)--> RAV Frontend
```

The MCP server runs a local WebSocket server on port 9274. When RAV starts, its
frontend automatically connects to this WebSocket. Commands from Claude flow
through the MCP server to the running app and back.

## Recommended End-User Setup

Use the desktop app's **MCP Setup** dialog. It exposes a stable `rav-mcp-rav`
launcher path, detects Codex / Claude clients, reports whether `rav-mcp` is
already configured there, offers one-click install / reinstall / remove, lets
you change the bridge port, and exposes a `Script Access` toggle for MCP code
execution. No Node install is required for the packaged app.

Representative snippets:

```bash
claude mcp add-json -s user rav-mcp '{"type":"stdio","command":"/Users/you/.local/bin/rav-mcp-rav","args":["--stdio-only","--port","9274"]}'
```

```toml
[mcp_servers."rav-mcp"]
command = "/Users/you/.local/bin/rav-mcp-rav"
args = ["--stdio-only", "--port", "9274"]
```

## JS Reference Server Setup

### 1. Install dependencies

```bash
cd mcp-server
npm install
```

### 2. Register the JS server with Claude Code

```bash
claude mcp add rav-mcp -- node /path/to/rive-animation-viewer/mcp-server/index.js
```

Or add manually as a stdio server:

```json
{
  "type": "stdio",
  "command": "node",
  "args": ["/path/to/rive-animation-viewer/mcp-server/index.js"]
}
```

### 3. Start RAV

Launch the Rive Animation Viewer (desktop app or `npm start` for web). The MCP
bridge in the frontend will auto-connect to the WebSocket server.

### 4. Use from Claude Code

Once connected, Claude has access to all RAV tools. Try:

- "Open the file /path/to/animation.riv in RAV"
- "Show me the ViewModel tree"
- "Set the `progress` property to 0.75"
- "Pause the animation"
- "Generate the live web instantiation snippet for CDN usage"

## Available Tools (49)

| Tool | Description |
|------|-------------|
| `rav_status` | App status: file, runtime, playback, live instantiation mode, ViewModel summary |
| `rav_set_anonymous_usage` | Enable or disable anonymous version reporting through the Settings preference controller |
| `rav_open_file` | Open a .riv file by absolute path |
| `rav_play` | Start/resume playback |
| `rav_pause` | Pause playback |
| `rav_reset` | Restart animation (preserves ViewModel values) |
| `rav_get_artboards` | List artboard names |
| `rav_get_state_machines` | List state machine names |
| `rav_switch_artboard` / `rav_reset_artboard` | Switch artboard/playback or reset to default |
| `rav_switch_vm_instance` | Bind a specific authored or runtime/list ViewModel instance key |
| `rav_get_vm_tree` | Full ViewModel hierarchy |
| `rav_vm_get` | Get ViewModel property value by path |
| `rav_vm_set` | Set ViewModel property value by path |
| `rav_vm_fire` | Fire a trigger property |
| `rav_vm_set_image` / `rav_vm_clear_image` | Set or clear an image on the authoritative root ViewModel |
| `rav_get_global_vm_tree` | List every named file-level global ViewModel and its hierarchy |
| `rav_global_vm_get` / `rav_global_vm_set` / `rav_global_vm_fire` | Read, write, or fire a property in a specifically named global ViewModel |
| `rav_global_vm_set_image` / `rav_global_vm_clear_image` | Set or clear a named global ViewModel image through authoritative playback |
| `rav_get_event_log` | Recent event log entries |
| `rav_get_editor_code` | Current script editor contents |
| `rav_set_editor_code` | Replace script editor contents |
| `rav_apply_code` | Apply editor code and refresh the live instance (`Script Access` required) |
| `rav_set_runtime` | Switch runtime (webgl2/canvas) |
| `rav_set_layout` / `rav_set_alignment` | Set layout fit mode and nine-way canvas alignment |
| `rav_set_canvas_color` | Set background color |
| `rav_set_canvas_size` | Set canvas sizing mode plus explicit pixel width/height and optional aspect lock |
| `rav_capture_canvas` | Capture the authoritative rendered canvas as a PNG image with render metadata |
| `rav_open_isolated_playback` | Open the current animation in an ordinary isolated diagnostic WebView |
| `rav_export_demo` | Export standalone HTML demo |
| `rav_export_demo_visual` | Drive the visible export dialog with exact control selection, package source, snippet mode, and output path |
| `generate_web_instantiation_code` | Generate the canonical live web snippet for `local` or `cdn` usage, exposing only selected typed accessors on `window.riveProperties`. Preferred over hand-writing snippets from scratch. |
| `rav_toggle_instantiation_controls_dialog` | Open/close the in-app Snippet & Export Controls dialog so a human can curate which controls are serialized |
| `rav_configure_workspace` | Set left/right sidebar visibility, live source mode, and VM Explorer snippet presence in one idempotent call |
| `rav_get_sm_inputs` | List state machine inputs with values |
| `rav_set_sm_input` | Set state machine input value |
| `rav_eval` | Evaluate JS with `target: auto|host|playback`, returning the resolved surface/session (`Script Access` required) |
| `rav_console_open` / `rav_console_close` | Toggle the JS console panel |
| `rav_console_set_mode` / `rav_console_set_filter` / `rav_console_clear` | Switch console mode, mirror visible filters, and clear the active transcript |
| `rav_console_read` / `rav_console_exec` | Read the JS console transcript or run REPL code (`rav_console_exec` requires `Script Access`). Transcript includes REPL input/result rows plus captured `console.*` output. |

## Live Instantiation Semantics

- RAV can be running in `internal` mode or `editor` mode.
- `rav_apply_code` switches the live instance to the last applied editor config.
- `rav_status` reports the active canvas sizing state, and `rav_set_canvas_size` can switch between auto sizing and fixed explicit pixels.
- ViewModel paths are slash-separated. Dynamic list items use a zero-based live index such as `rows/0/playerName`; call `rav_get_vm_tree` again after the controlling count changes before addressing newly added or removed rows.
- Global ViewModel tools require both the file-level ViewModel name and its property path, preventing collisions when multiple globals expose the same path.
- Unsaved editor draft changes do not affect the running animation until applied.
- `generate_web_instantiation_code` always reflects the currently running live mode.
- `generate_web_instantiation_code` defaults to the CDN form unless you request `package_source: "local"`.
- Single-state-machine snippets and demos use `stateMachine` on runtime 2.41+ and `stateMachines` on older versions. Existing plural editor configs still work; explicit legacy timelines, multi-machine playback, inputs, and callbacks retain compatibility and may still produce upstream deprecation warnings. Match the reported runtime version when installing the package for a LOCAL snippet.
- `rav_eval` defaults to `target: "auto"`: an active authoritative playback child wins; otherwise evaluation uses the host WebView. `target: "playback"` is strict and never falls back, while `target: "host"` deliberately inspects the UI WebView. Every result labels the resolved target, surface, and child session.
- The console tools remain host-UI tools. Their transcript does not include the isolated child's `console.*` calls or claim live Luau-output authority; use a playback-target eval for bounded child inspection and rely on runtime/Rive events for supported live signals.
- Compact snippets expose only checked ViewModel/state-machine accessors on `window.riveProperties`; scaffold snippets list every accessor and comment out unchecked ones. Snippets do not replay captured values.
- Fixed-size snippets and exported demos preserve explicit `width × height` canvas dimensions when the viewer is pinned to a pixel size.
- Oversized fixed-size snippets and exported demos keep the canvas centered in the viewport instead of pinning it to the upper-left corner.
- The **Snippet & Export Controls** dialog lets a human user choose which accessors appear in snippets and which current values are restored by standalone exports. If untouched, RAV defaults to the changed-control set.
- `rav_toggle_instantiation_controls_dialog` is the MCP hook for opening that dialog when a human needs to curate the export.
- Exported demos now embed both snippet forms, default the copy button to CDN, and expose a **Copy Instantiation Code** button in the demo toolbar.
- If `Script Access` is disabled in the MCP dialog, `rav_eval`, `rav_console_exec`, and `rav_apply_code` are rejected while read-only control tools remain available.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RAV_MCP_PORT` | `9274` | WebSocket bridge port |

The isolated `2.5.4 DEV` app reserves port `9278` and ignores a stored
production-port value, so it can run beside the production app without sharing
its bridge. If a localhost browser preview also connects to `9278`, the bridge
keeps the packaged desktop app authoritative; legacy clients remain compatible,
and stale replies from a non-selected preview cannot satisfy an MCP request.

## Troubleshooting

**"RAV is not connected"** - Make sure the Rive Animation Viewer app is running.
Check the browser console for `[rav-mcp-bridge]` messages.

**Bridge not connecting** - Verify the MCP server is running on the configured
port from the MCP Setup dialog. The bridge starts automatically with the app
and keeps retrying until a client attaches.

**RAV 2.4.1 says the sidecar is not beside the app executable (macOS)** - The
signed sidecar is present at
`/Applications/Rive Animation Viewer.app/Contents/MacOS/rav-mcp`; 2.4.1 can
fail while resolving its sibling path. Update to 2.4.2 or later. Reinstalling
2.4.1 does not fix this regression; the fixed release also refreshes an
existing stable MCP launcher symlink during startup.

**Desktop app setup still mentions Node** - Update to a build that includes the
native `rav-mcp` sidecar and use the in-app MCP Setup dialog instead of the
source-only JS server path.
