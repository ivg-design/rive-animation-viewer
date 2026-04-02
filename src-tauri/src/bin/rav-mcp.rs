use anyhow::{anyhow, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{self, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use uuid::Uuid;

const SERVER_NAME: &str = "rav-mcp";
const SERVER_VERSION: &str = "1.0.1";
const DEFAULT_WS_PORT: u16 = 9274;
const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";

const SERVER_INSTRUCTIONS: &str = r#"# RAV MCP — Rive Animation Viewer Remote Control

You are connected to a running instance of Rive Animation Viewer (RAV), a desktop app for inspecting .riv animation files.

## Quick Start Workflow
1. **rav_status** — Always call this first to see what's loaded and the current state.
2. **rav_open_file** — Open a .riv file by absolute path (Tauri desktop only).
3. **rav_get_artboards** / **rav_get_state_machines** — Discover what's in the file.
4. **rav_get_vm_tree** — Inspect the ViewModel hierarchy (properties, types, paths, current values).
5. Use **rav_vm_get** / **rav_vm_set** / **rav_vm_fire** to read, write, and fire ViewModel properties by path.

## Key Concepts

### Rive Runtime API
- `contents`, `stateMachineNames`, `animationNames` are **properties** (not functions) on the Rive instance.
- `stateMachineInputs(smName)` IS a function that takes the state machine name.
- `viewModelInstance` is a **property** that returns the bound ViewModel instance (requires `autoBind: true`).

### ViewModel Paths
- Properties use slash-separated paths: `"parentVM/childVM/property"`
- Supported kinds: `number`, `boolean`, `string`, `enum`, `color`, `trigger`
- Access pattern: `vm.number("propName").value` to read, `vm.number("propName").value = 42` to write
- Triggers use `vm.trigger("propName").trigger()` (note: the method is .trigger(), not .fire())

### Script Editor
- The editor holds a JavaScript object literal that configures the Rive instance.
- RAV has two live instantiation modes: `internal` and `editor`.
- `internal` means the running animation is using RAV's built-in wiring and the current toolbar/artboard state.
- `editor` means the running animation is using the last applied editor code, not necessarily the current unsaved draft in the panel.
- `autoBind: true` is required for ViewModel access.
- `stateMachines: "Name"` must be set to activate a state machine.
- Use **rav_set_editor_code** then **rav_apply_code** to change configuration and reload.
- **rav_status** returns the live instantiation source and whether the editor has unapplied draft changes.
- **generate_web_instantiation_code** returns the canonical copy-paste snippet for the live mode currently running in RAV.

### State Machines vs ViewModels
- **State machine inputs** are the legacy way to control animations (boolean, number, trigger).
- **ViewModel properties** are the modern data-binding approach with richer types.
- Many animations have both — check rav_get_sm_inputs AND rav_get_vm_tree.

## Tips
- If rav_get_vm_tree returns empty but you suspect there's a ViewModel, ensure the editor config includes `autoBind: true` and `stateMachines` is set, then call rav_apply_code.
- Use **rav_eval** for anything not covered by the dedicated tools — it runs JS in the browser context with access to `window.riveInst` and all globals.
- **rav_get_event_log** shows runtime events, user events, UI events, and MCP events — useful for debugging what happened.
- **rav_console_open** / **rav_console_close** toggle the JS console panel.
- **rav_console_read** returns captured console.* output (all calls since app start).
- **rav_console_exec** evaluates code in the REPL with output shown in the console panel.
- **rav_export_demo** creates a self-contained HTML file with the current animation, runtime, and settings baked in.
- **generate_web_instantiation_code** is the preferred way to get a web snippet. It bakes in the current runtime package, artboard/playback selection, layout fit/alignment, background mode, and the active instantiation source."#;

#[derive(Default)]
struct BridgeState {
    sender: Option<mpsc::UnboundedSender<String>>,
    pending: HashMap<String, oneshot::Sender<Result<Value, String>>>,
    active_connection_id: u64,
    next_connection_id: u64,
}

#[derive(Clone)]
struct Bridge {
    inner: Arc<Mutex<BridgeState>>,
    command_timeout: Duration,
}

impl Bridge {
    fn new(command_timeout: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(BridgeState::default())),
            command_timeout,
        }
    }

    async fn send_command(&self, command: &str, params: Value) -> Result<Value> {
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        let payload = json!({
            "id": request_id,
            "command": command,
            "params": params,
        });

        {
            let mut state = self.inner.lock().await;
            let sender = state.sender.clone().ok_or_else(|| {
                anyhow!(
                    "RAV is not connected. Make sure the Rive Animation Viewer is running and the MCP bridge is enabled."
                )
            })?;
            state.pending.insert(request_id.clone(), tx);
            if sender.send(payload.to_string()).is_err() {
                state.pending.remove(&request_id);
                return Err(anyhow!(
                    "RAV MCP bridge is unavailable. Reopen the MCP connection inside the app and try again."
                ));
            }
        }

        match timeout(self.command_timeout, rx).await {
            Ok(Ok(Ok(result))) => Ok(result),
            Ok(Ok(Err(message))) => Err(anyhow!(message)),
            Ok(Err(_)) => Err(anyhow!("RAV request channel closed unexpectedly")),
            Err(_) => {
                let mut state = self.inner.lock().await;
                state.pending.remove(&request_id);
                Err(anyhow!(
                    "Command \"{}\" timed out after {}ms",
                    command,
                    self.command_timeout.as_millis()
                ))
            }
        }
    }

    async fn register_connection(&self, sender: mpsc::UnboundedSender<String>) -> u64 {
        let mut state = self.inner.lock().await;
        reject_all_pending(&mut state, "RAV reconnected".into());
        state.next_connection_id += 1;
        state.active_connection_id = state.next_connection_id;
        state.sender = Some(sender);
        state.active_connection_id
    }

    async fn handle_incoming_message(&self, message: Value) {
        let Some(request_id) = message.get("id").and_then(Value::as_str).map(str::to_owned) else {
            return;
        };

        let pending = {
            let mut state = self.inner.lock().await;
            state.pending.remove(&request_id)
        };

        let Some(pending) = pending else {
            return;
        };

        if let Some(error) = message.get("error") {
            let error_text = if let Some(text) = error.as_str() {
                text.to_string()
            } else {
                error.to_string()
            };
            let _ = pending.send(Err(error_text));
            return;
        }

        let result = message.get("result").cloned().unwrap_or(Value::Null);
        let _ = pending.send(Ok(result));
    }

    async fn handle_disconnect(&self, connection_id: u64, message: String) {
        let mut state = self.inner.lock().await;
        if state.active_connection_id != connection_id {
            return;
        }
        state.sender = None;
        reject_all_pending(&mut state, message);
    }
}

fn reject_all_pending(state: &mut BridgeState, message: String) {
    for (_, pending) in state.pending.drain() {
        let _ = pending.send(Err(message.clone()));
    }
}

fn tools_list() -> Value {
    json!([
        {
            "name": "rav_status",
            "description": "Get current RAV application status: loaded file, runtime, playback state, ViewModel summary, and connection info.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_open_file",
            "description": "Open a .riv file in RAV by its absolute file path. The file is read from disk and loaded into the viewer.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path to the .riv file on disk" }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "rav_play",
            "description": "Start or resume animation playback.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_pause",
            "description": "Pause animation playback.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_reset",
            "description": "Reset and restart the animation from the beginning, preserving ViewModel control values.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_get_artboards",
            "description": "List all artboard names available in the currently loaded .riv file.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_get_state_machines",
            "description": "List all state machine names on the current artboard.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_switch_artboard",
            "description": "Switch to a different artboard and/or playback target (state machine or animation). Auto-plays immediately. ViewModel controls re-populate for the new artboard.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "artboard": { "type": "string", "description": "Artboard name to switch to" },
                    "playback": {
                        "type": "string",
                        "description": "Playback target. Prefix with \"sm:\" for state machine or \"anim:\" for timeline animation. E.g. \"sm:State Machine 1\" or \"anim:idle\". Omit to use the first available."
                    }
                },
                "required": ["artboard"],
                "additionalProperties": false
            }
        },
        {
            "name": "rav_reset_artboard",
            "description": "Reset to the default artboard and default state machine that was detected when the file was first loaded.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_get_vm_tree",
            "description": "Get the full ViewModel hierarchy tree for the loaded animation. Returns nested structure with property names, paths, kinds (number, boolean, string, enum, color, trigger), and child ViewModels/lists.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_vm_get",
            "description": "Get the current value of a ViewModel property by path. Use rav_get_vm_tree first to discover available paths.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Dot-separated or slash-separated property path, e.g. \"root/nested/prop\"" }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "rav_vm_set",
            "description": "Set the value of a ViewModel property by path. Supports number, boolean, string, enum, and color properties.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Property path (slash-separated)" },
                    "value": { "description": "New value. Type must match the property kind: number for number, true/false for boolean, string for string/enum, ARGB integer for color." }
                },
                "required": ["path", "value"],
                "additionalProperties": false
            }
        },
        {
            "name": "rav_vm_fire",
            "description": "Fire a trigger ViewModel property by path.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to the trigger property" }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "rav_get_event_log",
            "description": "Get recent event log entries from RAV. Events include native runtime events, Rive user events, and UI events.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "number", "description": "Maximum number of entries to return (default 50)" },
                    "source": { "type": "string", "enum": ["native", "rive-user", "ui", "all"], "description": "Filter by event source (default \"all\")" }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "rav_get_editor_code",
            "description": "Get the current code in the RAV script editor (CodeMirror).",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_set_editor_code",
            "description": "Replace the code in the RAV script editor. This does NOT reload the animation — call rav_apply_code afterwards to apply changes.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "code": { "type": "string", "description": "JavaScript code to set in the editor" }
                },
                "required": ["code"],
                "additionalProperties": false
            }
        },
        {
            "name": "rav_apply_code",
            "description": "Apply the current editor code and reload the animation with the new configuration. Equivalent to clicking the \"Apply & Reload\" button.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_set_runtime",
            "description": "Switch the Rive runtime engine.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runtime": { "type": "string", "enum": ["webgl2", "canvas"], "description": "Runtime to switch to" }
                },
                "required": ["runtime"],
                "additionalProperties": false
            }
        },
        {
            "name": "rav_set_layout",
            "description": "Set the canvas layout fit mode.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "fit": { "type": "string", "enum": ["cover", "contain", "fill", "fitWidth", "fitHeight", "scaleDown", "none", "layout"], "description": "Layout fit mode" }
                },
                "required": ["fit"],
                "additionalProperties": false
            }
        },
        {
            "name": "rav_set_canvas_color",
            "description": "Set the canvas background color. Use \"transparent\" for transparency mode.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "color": { "type": "string", "description": "CSS color value (hex like \"#0d1117\") or \"transparent\"" }
                },
                "required": ["color"],
                "additionalProperties": false
            }
        },
        {
            "name": "rav_export_demo",
            "description": "Export the current animation as a self-contained standalone HTML demo file. Provide output_path to save directly (recommended for MCP). Without output_path, opens a native save dialog (will timeout in MCP).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "output_path": { "type": "string", "description": "Absolute path where the HTML demo will be saved. Parent directories are created automatically. If omitted, a native save dialog opens (not usable from MCP)." }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "generate_web_instantiation_code",
            "description": "Generate a copy-paste-ready web instantiation snippet for the animation currently loaded in RAV. The snippet mirrors the live source mode that is actually running in RAV: either internal wiring or the last applied editor code. Supports either CDN or local npm package usage.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "package_source": { "type": "string", "enum": ["cdn", "local"], "description": "Use a CDN/global runtime snippet or a local npm package import snippet." }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "rav_get_sm_inputs",
            "description": "Get all state machine inputs for the current animation, with their names, types, and current values.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_set_sm_input",
            "description": "Set a state machine input value by name.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "State machine input name" },
                    "value": { "description": "New value (number, boolean, or \"fire\" for triggers)" }
                },
                "required": ["name", "value"],
                "additionalProperties": false
            }
        },
        {
            "name": "rav_eval",
            "description": "Evaluate arbitrary JavaScript in the RAV browser context. Has access to window.riveInst, window.vmGet/vmSet/vmFire, and all RAV globals. Use for advanced inspection or operations not covered by other tools. Returns the stringified result.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "expression": { "type": "string", "description": "JavaScript expression or statement to evaluate" }
                },
                "required": ["expression"],
                "additionalProperties": false
            }
        },
        {
            "name": "rav_console_open",
            "description": "Open the JavaScript console panel (switches from Event Console to JS Console mode).",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_console_close",
            "description": "Close the JavaScript console panel (switches back to Event Console mode).",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_console_read",
            "description": "Read captured console output (console.log/warn/error/info/debug). Returns the most recent entries with method, timestamp, and args.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "number", "description": "Maximum entries to return (default 50)" }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "rav_console_exec",
            "description": "Execute JavaScript in the REPL console. The code is evaluated in the browser context with output displayed in the console panel. Opens the console automatically if not already open.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "code": { "type": "string", "description": "JavaScript code to execute in the console REPL" }
                },
                "required": ["code"],
                "additionalProperties": false
            }
        }
    ])
}

async fn read_message(reader: &mut BufReader<tokio::io::Stdin>) -> Result<Option<Value>> {
    let mut content_length = None;

    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line).await?;
        if bytes_read == 0 {
            return Ok(None);
        }

        if line == "\n" || line == "\r\n" {
            break;
        }

        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                let parsed = value
                    .trim()
                    .parse::<usize>()
                    .context("invalid Content-Length header")?;
                content_length = Some(parsed);
            }
        }
    }

    let length = content_length.ok_or_else(|| anyhow!("missing Content-Length header"))?;
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload).await?;
    let message = serde_json::from_slice::<Value>(&payload)?;
    Ok(Some(message))
}

async fn write_message(writer: &mut BufWriter<tokio::io::Stdout>, value: &Value) -> Result<()> {
    let payload = serde_json::to_vec(value)?;
    let header = format!("Content-Length: {}\r\n\r\n", payload.len());
    writer.write_all(header.as_bytes()).await?;
    writer.write_all(&payload).await?;
    writer.flush().await?;
    Ok(())
}

fn jsonrpc_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message.into(),
        }
    })
}

fn jsonrpc_result(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

async fn handle_request(bridge: &Bridge, request: Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();

    match method {
        "initialize" => {
            let protocol_version = request
                .get("params")
                .and_then(|params| params.get("protocolVersion"))
                .and_then(Value::as_str)
                .unwrap_or(DEFAULT_PROTOCOL_VERSION);

            jsonrpc_result(
                id,
                json!({
                    "protocolVersion": protocol_version,
                    "capabilities": {
                        "tools": {
                            "listChanged": false
                        }
                    },
                    "serverInfo": {
                        "name": SERVER_NAME,
                        "version": SERVER_VERSION
                    },
                    "instructions": SERVER_INSTRUCTIONS
                }),
            )
        }
        "ping" => jsonrpc_result(id, json!({})),
        "tools/list" => jsonrpc_result(id, json!({ "tools": tools_list() })),
        "tools/call" => {
            let Some(params) = request.get("params") else {
                return jsonrpc_error(id, -32602, "Missing tool call params");
            };
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return jsonrpc_error(id, -32602, "Missing tool name");
            };
            let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

            match bridge.send_command(name, arguments).await {
                Ok(result) => {
                    let text = if let Some(text) = result.as_str() {
                        text.to_string()
                    } else {
                        serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string())
                    };
                    let mut payload = json!({
                        "content": [
                            {
                                "type": "text",
                                "text": text
                            }
                        ],
                        "isError": false
                    });
                    if !result.is_string() {
                        payload["structuredContent"] = result;
                    }
                    jsonrpc_result(id, payload)
                }
                Err(error) => jsonrpc_result(
                    id,
                    json!({
                        "content": [
                            {
                                "type": "text",
                                "text": format!("Error: {}", error)
                            }
                        ],
                        "isError": true
                    }),
                ),
            }
        }
        _ => jsonrpc_error(id, -32601, format!("Method not found: {}", method)),
    }
}

async fn run_stdio_server(bridge: Bridge) -> Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin);
    let mut writer = BufWriter::new(stdout);

    eprintln!("[rav-mcp] MCP server started (stdio transport)");

    loop {
        let Some(message) = read_message(&mut reader).await? else {
            break;
        };

        let is_notification = message.get("id").is_none();
        if is_notification {
            continue;
        }

        let response = handle_request(&bridge, message).await;
        write_message(&mut writer, &response).await?;
    }

    Ok(())
}

async fn run_websocket_bridge(bridge: Bridge, ws_port: u16) -> Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", ws_port))
        .await
        .with_context(|| format!("failed to bind WebSocket bridge on 127.0.0.1:{ws_port}"))?;

    eprintln!("[rav-mcp] WebSocket bridge listening on ws://127.0.0.1:{ws_port}");

    loop {
        let (stream, _) = listener.accept().await?;
        let bridge_clone = bridge.clone();

        tokio::spawn(async move {
            let websocket = match accept_async(stream).await {
                Ok(websocket) => websocket,
                Err(error) => {
                    eprintln!("[rav-mcp] WebSocket handshake failed: {error}");
                    return;
                }
            };

            let (mut sink, mut stream) = websocket.split();
            let (tx, mut rx) = mpsc::unbounded_channel::<String>();
            let connection_id = bridge_clone.register_connection(tx).await;

            eprintln!("[rav-mcp] RAV connected");

            let write_task = tokio::spawn(async move {
                while let Some(payload) = rx.recv().await {
                    if sink.send(Message::Text(payload)).await.is_err() {
                        break;
                    }
                }
            });

            while let Some(message) = stream.next().await {
                match message {
                    Ok(Message::Text(text)) => match serde_json::from_str::<Value>(&text) {
                        Ok(value) => bridge_clone.handle_incoming_message(value).await,
                        Err(_) => eprintln!("[rav-mcp] Received invalid JSON from RAV"),
                    },
                    Ok(Message::Binary(bytes)) => match serde_json::from_slice::<Value>(&bytes) {
                        Ok(value) => bridge_clone.handle_incoming_message(value).await,
                        Err(_) => eprintln!("[rav-mcp] Received invalid JSON from RAV"),
                    },
                    Ok(Message::Close(_)) => break,
                    Ok(_) => {}
                    Err(error) => {
                        eprintln!("[rav-mcp] WebSocket error: {error}");
                        break;
                    }
                }
            }

            write_task.abort();
            bridge_clone
                .handle_disconnect(connection_id, "RAV disconnected".into())
                .await;
            eprintln!("[rav-mcp] RAV disconnected");
        });
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let ws_port = env::var("RAV_MCP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_WS_PORT);
    let command_timeout_ms = env::var("RAV_MCP_TIMEOUT")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_COMMAND_TIMEOUT_MS);

    let bridge = Bridge::new(Duration::from_millis(command_timeout_ms));
    let websocket_bridge = run_websocket_bridge(bridge.clone(), ws_port);
    let stdio_server = run_stdio_server(bridge);

    tokio::select! {
        result = websocket_bridge => result,
        result = stdio_server => result,
    }
}
