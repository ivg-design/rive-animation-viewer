use serde_json::{json, Value};

pub fn tools_list() -> Value {
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
            "name": "rav_set_canvas_size",
            "description": "Set explicit canvas pixel sizing. Use mode \"fixed\" with width/height for a pinned canvas, or mode \"auto\" to follow the viewer size.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "enum": ["auto", "fixed"], "description": "Canvas sizing mode. Defaults to \"fixed\"." },
                    "width": { "type": "number", "description": "Explicit canvas width in pixels when mode is \"fixed\"." },
                    "height": { "type": "number", "description": "Explicit canvas height in pixels when mode is \"fixed\"." },
                    "lockAspectRatio": { "type": "boolean", "description": "Whether width/height updates should preserve aspect ratio." }
                },
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
            "description": "Generate a copy-paste-ready web instantiation snippet for the animation currently loaded in RAV. The snippet mirrors the live source mode that is actually running in RAV: either internal wiring or the last applied editor code. Supports either CDN or local npm package usage, restores the current ViewModel/state-machine values on load, and exposes helper controls on window.ravRive.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "package_source": { "type": "string", "enum": ["cdn", "local"], "description": "Use a CDN/global runtime snippet or a local npm package import snippet." },
                    "snippet_mode": { "type": "string", "enum": ["compact", "scaffold"], "description": "Use a compact snippet with only selected live controls, or a scaffold snippet that lists all controls with unselected ones commented out." }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "rav_toggle_instantiation_controls_dialog",
            "description": "Open, close, or toggle the Snippet & Export Controls dialog inside RAV. Use this when a human user should choose exactly which bound controls are serialized into snippets and demos.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["open", "close", "toggle"], "description": "Whether to open, close, or toggle the dialog. Defaults to toggle." }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "rav_configure_workspace",
            "description": "Set workspace UI state inside RAV. This can open or close the left/right sidebars, switch the live instantiation source between internal and editor mode, and inject or remove the VM Explorer snippet without guessing current state.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "left_sidebar": { "type": "string", "enum": ["open", "close"], "description": "Open or close the left editor sidebar." },
                    "right_sidebar": { "type": "string", "enum": ["open", "close"], "description": "Open or close the right properties sidebar." },
                    "source_mode": { "type": "string", "enum": ["internal", "editor"], "description": "Set the live instantiation source. editor applies the current draft code; internal switches back to RAV wiring." },
                    "vm_explorer": { "type": "string", "enum": ["inject", "remove"], "description": "Ensure the VM Explorer snippet is present or removed in the editor draft." }
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
