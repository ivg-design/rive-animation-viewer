export const SERVER_INSTRUCTIONS = `
# RAV MCP — Rive Animation Viewer Remote Control

You are connected to a running instance of Rive Animation Viewer (RAV), a desktop app for inspecting .riv animation files.

## Quick Start Workflow
1. **rav_status** — Always call this first to see what's loaded and the current state.
2. **rav_open_file** — Open a .riv file by absolute path (Tauri desktop only).
3. **rav_get_artboards** / **rav_get_state_machines** — Discover what's in the file.
4. **rav_get_vm_tree** — Inspect the ViewModel hierarchy (properties, types, paths, current values).
5. Use **rav_vm_get** / **rav_vm_set** / **rav_vm_fire** to read, write, and fire ViewModel properties by path.
6. Use **rav_get_global_vm_tree** and **rav_global_vm_get/set/fire** for named file-level global ViewModels; always pass both the global ViewModel name and its property path.
7. Use **rav_global_vm_set_image** / **rav_global_vm_clear_image** for global ViewModel image properties; image writes require the authoritative desktop playback surface.
8. Use **rav_capture_canvas** when you need PNG image content from the canvas exactly as RAV rendered it.

## Key Concepts

### Rive Runtime API
- \`contents\`, \`stateMachineNames\`, \`animationNames\` are **properties** (not functions) on the Rive instance.
- \`stateMachineInputs(smName)\` IS a function that takes the state machine name.
- \`viewModelInstance\` is a **property** that returns the currently bound ViewModel instance. \`autoBind: true\` binds the default instance automatically; RAV uses \`autoBind: false\` when it explicitly binds a named instance.

### ViewModel Paths
- Properties use slash-separated paths: \`"parentVM/childVM/property"\`
- List items use a zero-based index segment, for example \`"rows/0/playerName"\`. Always call \`rav_get_vm_tree\` again after a list resizes so the path is inside the current live bounds.
- Supported kinds: \`number\`, \`boolean\`, \`string\`, \`enum\`, \`color\`, \`trigger\`
- Access pattern: \`vm.number("propName").value\` to read, \`vm.number("propName").value = 42\` to write
- Triggers use \`vm.trigger("propName").trigger()\` (note: the method is .trigger(), not .fire())

### Script Editor
- The editor holds a JavaScript object literal that configures the Rive instance.
- RAV has two live instantiation modes: \`internal\` and \`editor\`.
- \`internal\` means the running animation is using RAV's built-in wiring and the current toolbar/artboard state.
- \`editor\` means the running animation is using the last applied editor code, not necessarily the current unsaved draft in the panel.
- \`autoBind: true\` automatically binds the default ViewModel instance. An explicit instance selection deliberately loads with \`autoBind: false\` and binds that selected instance before controls and snapshots are restored.
- On Web 2.41+, prefer \`stateMachine: "Name"\` for one state machine. RAV retains \`stateMachines\` for older runtimes, multiple machines, and mixed animation/state-machine playback.
- If the user asks for a working instantiation snippet, prefer **generate_web_instantiation_code** first instead of hand-writing one from scratch.
- If you do need to edit the live config, call **rav_get_editor_code** first and modify the returned object surgically. Do not invent placeholder globals like `FILE`, `FILE_PATH`, or custom file tokens.
- Use **rav_set_editor_code** then **rav_apply_code** to change configuration and reload.
- **rav_status** returns the live instantiation source and whether the editor has unapplied draft changes.
- **generate_web_instantiation_code** returns the canonical copy-paste snippet for the live mode currently running in RAV.
- The returned snippet defaults to the \`cdn\` form unless you explicitly request \`package_source: "local"\`.
- The returned snippet exposes only the selected typed ViewModel/state-machine accessors on \`window.riveProperties\`; it does not replay captured values.
- Standalone HTML export is separate: it embeds the runtime and UI chrome and restores the selected live values.

### State Machines vs ViewModels
- **State machine inputs** are the legacy way to control animations (boolean, number, trigger).
- **ViewModel properties** are the modern data-binding approach with richer types.
- Many animations have both — check rav_get_sm_inputs AND rav_get_vm_tree.

## Tips
- If rav_get_vm_tree returns empty but you suspect there is a ViewModel, verify that a default or explicit VM instance is selected and bound. Use \`autoBind: true\` for the default instance, or select an explicit instance in RAV; configure the state machine separately when playback requires one.
- Use **rav_eval** for anything not covered by the dedicated tools. Its \`target\` is \`auto\`, \`playback\`, or \`host\`: \`auto\` uses the active authoritative playback child when one exists and reports the resolved surface/session; \`playback\` never falls back; \`host\` is an explicit UI-WebView diagnostic.
- In a playback-target eval, \`window.riveInst\` belongs to the authoritative child. In a host-target eval it belongs to the hidden host renderer and may be stale while an isolated child is active. Do not assume a local callback variable like \`rive\` remains current after reloads.
- **rav_get_event_log** shows runtime events, user events, UI events, and MCP events — useful for debugging what happened.
- **rav_console_open** / **rav_console_close** toggle the JS console panel. \`rav_console_open\` accepts optional \`mode\` (events/js), \`level\`, \`sources\`, and \`search\` to apply a filter on open.
- **rav_console_set_mode** flips the panel between Events and JS modes (or \`closed\`) without re-opening.
- **rav_console_set_filter** mirrors the existing on-screen filter toggles: \`level\` (all/info/warning/error) for JS mode, \`sources\` subset of (native/riveUser/ui/mcp) for Events mode, plus optional \`search\` substring.
- **rav_console_clear** clears the visible transcript of the active mode (or a specified mode) without closing the panel.
- **rav_console_read** returns only the host UI WebView's JS-console transcript, including its REPL rows and captured host \`console.*\` output. It does not claim child-WebView or live Luau-output authority.
- **rav_console_exec** evaluates code in the REPL with output shown in the console panel. Use \`rav_console_read\` to verify what actually happened instead of assuming execution succeeded.
- **rav_export_demo** creates a self-contained HTML file with the current animation, runtime, and settings baked in.
- **rav_export_demo_visual** orchestrates the Snippet & Export Controls dialog visibly (open → selection → package/mode → Export → save) for screen recordings or non-default selections.
- **rav_configure_workspace** sets left/right sidebar visibility, live editor/internal mode, and VM Explorer snippet state in one idempotent call.
- **generate_web_instantiation_code** is the preferred way to get a web snippet. It bakes in the current runtime package, artboard/playback selection, layout fit/alignment, background mode, the active instantiation source, and the currently selected bound control values.
- **rav_toggle_instantiation_controls_dialog** opens the in-app control-selection dialog so a human can choose exactly which values will be serialized into snippets and exported demos.
`.trim();
