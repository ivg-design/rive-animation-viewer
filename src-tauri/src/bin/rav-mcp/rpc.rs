use serde_json::{json, Value};

use crate::bridge::Bridge;
use crate::support::constants::{DEFAULT_PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION};
use crate::support::instructions::SERVER_INSTRUCTIONS;
use crate::tool_registry::tools_list;

pub fn jsonrpc_error(id: Value, code: i64, message: impl Into<String>) -> Value {
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

pub async fn handle_request(bridge: &Bridge, request: Value) -> Value {
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
                        "prompts": {
                            "listChanged": false
                        },
                        "resources": {
                            "listChanged": false,
                            "subscribe": false
                        },
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
        "prompts/list" => jsonrpc_result(id, json!({ "prompts": [] })),
        "resources/list" => jsonrpc_result(id, json!({ "resources": [] })),
        "resources/templates/list" => jsonrpc_result(id, json!({ "resourceTemplates": [] })),
        "logging/setLevel" => jsonrpc_result(id, json!({})),
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
