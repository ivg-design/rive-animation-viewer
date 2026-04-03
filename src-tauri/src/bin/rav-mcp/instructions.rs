pub const SERVER_INSTRUCTIONS: &str = r#"# RAV MCP — Rive Animation Viewer Remote Control

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
- The returned snippet defaults to the `cdn` form unless you explicitly request `package_source: "local"`.
- The returned snippet restores the current ViewModel/state-machine values on load and exposes `window.ravRive` helpers for VM and state-machine control.

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
- **rav_configure_workspace** sets left/right sidebar visibility, live editor/internal mode, and VM Explorer snippet state in one idempotent call.
- **generate_web_instantiation_code** is the preferred way to get a web snippet. It bakes in the current runtime package, artboard/playback selection, layout fit/alignment, background mode, the active instantiation source, and the currently selected bound control values.
- **rav_toggle_instantiation_controls_dialog** opens the in-app control-selection dialog so a human can choose exactly which values will be serialized into snippets and exported demos."#;
