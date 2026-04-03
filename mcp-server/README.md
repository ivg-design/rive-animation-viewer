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

Use the desktop app's **MCP Setup** dialog. It exposes the bundled `rav-mcp`
binary path, detects Codex / Claude clients, reports whether `rav-mcp` is
already configured there, offers one-click install / reinstall / remove, lets
you change the bridge port, and exposes a `Script Access` toggle for MCP code
execution. No Node install is required for the packaged app.

Representative snippets:

```bash
claude mcp add-json -s user rav-mcp '{"type":"stdio","command":"/Applications/Rive Animation Viewer.app/Contents/Resources/resources/rav-mcp","args":["--stdio-only","--port","9274"]}'
```

```toml
[mcp_servers."rav-mcp"]
command = "/Applications/Rive Animation Viewer.app/Contents/Resources/resources/rav-mcp"
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

## Available Tools (30)

| Tool | Description |
|------|-------------|
| `rav_status` | App status: file, runtime, playback, live instantiation mode, ViewModel summary |
| `rav_open_file` | Open a .riv file by absolute path |
| `rav_play` | Start/resume playback |
| `rav_pause` | Pause playback |
| `rav_reset` | Restart animation (preserves ViewModel values) |
| `rav_get_artboards` | List artboard names |
| `rav_get_state_machines` | List state machine names |
| `rav_switch_artboard` / `rav_reset_artboard` | Switch artboard/playback or reset to default |
| `rav_get_vm_tree` | Full ViewModel hierarchy |
| `rav_vm_get` | Get ViewModel property value by path |
| `rav_vm_set` | Set ViewModel property value by path |
| `rav_vm_fire` | Fire a trigger property |
| `rav_get_event_log` | Recent event log entries |
| `rav_get_editor_code` | Current script editor contents |
| `rav_set_editor_code` | Replace script editor contents |
| `rav_apply_code` | Apply editor code and refresh the live instance (`Script Access` required) |
| `rav_set_runtime` | Switch runtime (webgl2/canvas) |
| `rav_set_layout` | Set layout fit mode |
| `rav_set_canvas_color` | Set background color |
| `rav_export_demo` | Export standalone HTML demo |
| `generate_web_instantiation_code` | Generate the canonical live web snippet for `local` or `cdn` usage, with `window.ravRive` helpers and current control values |
| `rav_toggle_instantiation_controls_dialog` | Open/close the in-app Snippet & Export Controls dialog so a human can curate which controls are serialized |
| `rav_get_sm_inputs` | List state machine inputs with values |
| `rav_set_sm_input` | Set state machine input value |
| `rav_eval` | Evaluate JS in RAV's browser context (`Script Access` required) |
| `rav_console_open` / `rav_console_close` | Toggle the JS console panel |
| `rav_console_read` / `rav_console_exec` | Read captured console output or run REPL code (`rav_console_exec` requires `Script Access`) |

## Live Instantiation Semantics

- RAV can be running in `internal` mode or `editor` mode.
- `rav_apply_code` switches the live instance to the last applied editor config.
- Unsaved editor draft changes do not affect the running animation until applied.
- `generate_web_instantiation_code` always reflects the currently running live mode.
- `generate_web_instantiation_code` defaults to the CDN form unless you request `package_source: "local"`.
- Generated snippets restore only the checked ViewModel/state-machine values on load, round numbers to 2 decimals, annotate enum choices inline, and expose helper methods on `window.ravRive`.
- The **Snippet & Export Controls** dialog lets a human user choose exactly which values are serialized. If untouched, RAV defaults to the changed-control set.
- `rav_toggle_instantiation_controls_dialog` is the MCP hook for opening that dialog when a human needs to curate the export.
- Exported demos now embed both snippet forms, default the copy button to CDN, and expose a **Copy Instantiation Code** button in the demo toolbar.
- If `Script Access` is disabled in the MCP dialog, `rav_eval`, `rav_console_exec`, and `rav_apply_code` are rejected while read-only control tools remain available.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RAV_MCP_PORT` | `9274` | WebSocket bridge port |
| `RAV_MCP_TIMEOUT` | `15000` | Command timeout in ms |

## Troubleshooting

**"RAV is not connected"** - Make sure the Rive Animation Viewer app is running.
Check the browser console for `[rav-mcp-bridge]` messages.

**Bridge not connecting** - Verify the MCP server is running on the configured
port from the MCP Setup dialog. The bridge starts automatically with the app
and keeps retrying until a client attaches.

**Desktop app setup still mentions Node** - Update to a build that includes the
native `rav-mcp` sidecar and use the in-app MCP Setup dialog instead of the
source-only JS server path.
