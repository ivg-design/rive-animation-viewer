use serde_json::{json, Value};
use std::time::Duration;

use crate::bridge::Bridge;
use crate::support::constants::{
    CAPTURE_COMMAND_TIMEOUT_MS, DEFAULT_PROTOCOL_VERSION, FILE_OPEN_COMMAND_TIMEOUT_MS,
    SERVER_NAME, SERVER_VERSION,
};
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

fn format_tool_result(name: &str, result: Value) -> Value {
    if name == "rav_capture_canvas" {
        let image = result.get("image").cloned().unwrap_or(Value::Null);
        let data = image
            .get("data")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mime_type = image
            .get("mimeType")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if data.is_empty() || mime_type != "image/png" {
            return json!({
                "content": [{
                    "type": "text",
                    "text": "Error: RAV returned an invalid canvas screenshot payload"
                }],
                "isError": true
            });
        }
        let metadata = result.get("metadata").cloned().unwrap_or_else(|| json!({}));
        let text = serde_json::to_string_pretty(&json!({ "metadata": metadata }))
            .unwrap_or_else(|_| "{\"metadata\":{}}".into());
        return json!({ "content": [{"type":"text","text":text}, {"type":"image","data":data,"mimeType":mime_type}], "structuredContent": {"metadata": metadata}, "isError": false });
    }
    let text = result.as_str().map(str::to_owned).unwrap_or_else(|| {
        serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string())
    });
    let rejected = result.get("applied").and_then(Value::as_bool) == Some(false);
    let mut payload = json!({"content":[{"type":"text","text":text}],"isError":rejected});
    if !result.is_string() {
        payload["structuredContent"] = result;
    }
    payload
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
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));

            let command_result = if name == "rav_open_file" {
                bridge
                    .send_command_with_timeout(
                        name,
                        arguments,
                        Duration::from_millis(FILE_OPEN_COMMAND_TIMEOUT_MS),
                    )
                    .await
            } else if name == "rav_capture_canvas" {
                bridge
                    .send_command_with_timeout(
                        name,
                        arguments,
                        Duration::from_millis(CAPTURE_COMMAND_TIMEOUT_MS),
                    )
                    .await
            } else {
                bridge.send_command(name, arguments).await
            };

            match command_result {
                Ok(result) => jsonrpc_result(id, format_tool_result(name, result)),
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

#[cfg(test)]
mod tests {
    use super::format_tool_result;
    use serde_json::json;

    #[test]
    fn canvas_capture_requires_nonempty_png_content() {
        let valid = format_tool_result(
            "rav_capture_canvas",
            json!({
                "image": {"data": "iVBORw0KGgo=", "mimeType": "image/png"},
                "metadata": {"width": 320}
            }),
        );
        assert_eq!(valid["isError"], false);
        assert_eq!(valid["content"][1]["type"], "image");
        assert_eq!(valid["content"][1]["data"], "iVBORw0KGgo=");

        for invalid in [
            json!({}),
            json!({"image": {"data": "", "mimeType": "image/png"}}),
            json!({"image": {"data": "abc", "mimeType": "image/jpeg"}}),
        ] {
            let result = format_tool_result("rav_capture_canvas", invalid);
            assert_eq!(result["isError"], true);
            assert_eq!(result["content"].as_array().map(Vec::len), Some(1));
        }
    }
}
