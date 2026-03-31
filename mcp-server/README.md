# RAV MCP Server

MCP (Model Context Protocol) server for Rive Animation Viewer. Lets Claude Code
(or any MCP client) control a running RAV instance: open files, inspect
ViewModels, drive playback, manipulate inputs, read event logs, and export demos.

## Architecture

```
Claude Code <--(stdio)--> MCP Server <--(WebSocket :9274)--> RAV Frontend
```

The MCP server runs a local WebSocket server on port 9274. When RAV starts, its
frontend automatically connects to this WebSocket. Commands from Claude flow
through the MCP server to the running app and back.

## Setup

### 1. Install dependencies

```bash
cd mcp-server
npm install
```

### 2. Register with Claude Code

```bash
claude mcp add rav-mcp node /path/to/rive-animation-viewer/mcp-server/index.js
```

Or add manually to `~/.claude.json`:

```json
{
  "mcpServers": {
    "rav-mcp": {
      "command": "node",
      "args": ["/path/to/rive-animation-viewer/mcp-server/index.js"]
    }
  }
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
- "What events has the animation fired?"

## Available Tools

| Tool | Description |
|------|-------------|
| `rav_status` | App status: file, runtime, playback, ViewModel summary |
| `rav_open_file` | Open a .riv file by absolute path |
| `rav_play` | Start/resume playback |
| `rav_pause` | Pause playback |
| `rav_reset` | Restart animation (preserves ViewModel values) |
| `rav_get_artboards` | List artboard names |
| `rav_get_state_machines` | List state machine names |
| `rav_get_vm_tree` | Full ViewModel hierarchy |
| `rav_vm_get` | Get ViewModel property value by path |
| `rav_vm_set` | Set ViewModel property value by path |
| `rav_vm_fire` | Fire a trigger property |
| `rav_get_event_log` | Recent event log entries |
| `rav_get_editor_code` | Current script editor contents |
| `rav_set_editor_code` | Replace script editor contents |
| `rav_apply_code` | Apply editor code and reload animation |
| `rav_set_runtime` | Switch runtime (webgl2/canvas) |
| `rav_set_layout` | Set layout fit mode |
| `rav_set_canvas_color` | Set background color |
| `rav_export_demo` | Export standalone HTML demo |
| `rav_get_sm_inputs` | List state machine inputs with values |
| `rav_set_sm_input` | Set state machine input value |
| `rav_eval` | Evaluate JS in RAV's browser context |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RAV_MCP_PORT` | `9274` | WebSocket bridge port |
| `RAV_MCP_TIMEOUT` | `15000` | Command timeout in ms |

## Troubleshooting

**"RAV is not connected"** - Make sure the Rive Animation Viewer app is running.
Check the browser console for `[rav-mcp-bridge]` messages.

**Bridge not connecting** - Verify the MCP server is running and port 9274 is
available. The bridge auto-reconnects with exponential backoff.
