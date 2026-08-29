use serde_json::{json, Value};

pub fn vm_tools() -> Vec<Value> {
    json!([
        {
            "name": "rav_switch_vm_instance",
            "description": "Switch to a specific ViewModel instance key and confirm that the dedicated playback surface bound that exact instance.",
            "inputSchema": {
                "type": "object",
                "properties": { "instance": { "type": ["string", "number"], "description": "ViewModel instance key, including zero-based runtime/list keys such as 0." } },
                "required": ["instance"], "additionalProperties": false
            }
        },
        {
            "name": "rav_get_vm_tree",
            "description": "Get the full live ViewModel hierarchy, paths, kinds, and nested/list instances.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_get_global_vm_tree",
            "description": "List every file-level global ViewModel with its live hierarchy, paths, kinds, and values.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "rav_global_vm_get",
            "description": "Get a value from a named file-level global ViewModel.",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string", "minLength": 1 }, "path": { "type": "string", "minLength": 1 } },
                "required": ["name", "path"], "additionalProperties": false
            }
        },
        {
            "name": "rav_global_vm_set",
            "description": "Set a number, boolean, string, enum, or color property on a named file-level global ViewModel.",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string", "minLength": 1 }, "path": { "type": "string", "minLength": 1 }, "value": {} },
                "required": ["name", "path", "value"], "additionalProperties": false
            }
        },
        {
            "name": "rav_global_vm_fire",
            "description": "Fire a trigger on a named file-level global ViewModel.",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string", "minLength": 1 }, "path": { "type": "string", "minLength": 1 } },
                "required": ["name", "path"], "additionalProperties": false
            }
        },
        {
            "name": "rav_global_vm_set_image",
            "description": "Set an image property on a named file-level global ViewModel through the authoritative playback surface.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "minLength": 1 },
                    "path": { "type": "string", "minLength": 1 },
                    "bytes": { "type": "array", "items": { "type": "integer", "minimum": 0, "maximum": 255 }, "minItems": 1, "maxItems": 16777216 },
                    "label": { "type": "string", "maxLength": 255 }
                },
                "required": ["name", "path", "bytes"], "additionalProperties": false
            }
        },
        {
            "name": "rav_global_vm_clear_image",
            "description": "Clear an image property on a named file-level global ViewModel through the authoritative playback surface.",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string", "minLength": 1 }, "path": { "type": "string", "minLength": 1 } },
                "required": ["name", "path"], "additionalProperties": false
            }
        },
        {
            "name": "rav_vm_get",
            "description": "Get a live ViewModel value by slash- or dot-separated path.",
            "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"], "additionalProperties": false }
        },
        {
            "name": "rav_vm_set",
            "description": "Set a number, boolean, string, enum, or color ViewModel property by path.",
            "inputSchema": { "type": "object", "properties": { "path": { "type": "string" }, "value": {} }, "required": ["path", "value"], "additionalProperties": false }
        },
        {
            "name": "rav_vm_set_image",
            "description": "Set a ViewModel image through the authoritative playback surface using a bounded byte array.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "bytes": { "type": "array", "items": { "type": "integer", "minimum": 0, "maximum": 255 }, "minItems": 1, "maxItems": 16777216 },
                    "label": { "type": "string", "maxLength": 255 }
                },
                "required": ["path", "bytes"], "additionalProperties": false
            }
        },
        {
            "name": "rav_vm_clear_image",
            "description": "Clear a ViewModel image through the authoritative playback surface.",
            "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"], "additionalProperties": false }
        },
        {
            "name": "rav_vm_fire",
            "description": "Fire a trigger ViewModel property by path.",
            "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"], "additionalProperties": false }
        }
    ]).as_array().cloned().unwrap_or_default()
}
