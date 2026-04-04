# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [2.1.1] - 2026-04-04

### Changed

- **Desktop window chrome** — macOS now uses a supported overlay-titlebar host with the custom RAV header, corrected window controls, centered file metadata, and properly rounded outer window corners instead of the unstable square-host experiments from the late 2.1.0 cycle.
- **Runtime strip cleanup** — Simplified the bottom strip so the console control is open/close only, runtime info is more compact, and the strip no longer repeats redundant build/file tokens already available elsewhere in the app.
- **Snippet/export templates** — Tightened generated instantiation code so zero-control exports stay minimal, section labels preserve authored casing, manual trigger behavior is documented clearly, and runtime helpers no longer over-serialize placeholder blocks.

### Fixed

- **MCP activity states** — The MCP chip now distinguishes disabled, connected-idle, and actively-used states instead of staying bright while no command is running.
- **JavaScript console stability** — Fixed multiple JS console regressions: toggle freezes, misplaced REPL rows, broken `FOLLOW` anchoring, and copy/filter behavior drifting away from the visible Eruda transcript.
- **Snippet/demo runtime errors** — Exported demos no longer reference missing helper functions during bootstrap, and generated helper runtime code now handles falsy VM returns and trigger/value edge cases correctly.
- **Desktop scrollbars and About layout** — Shared scrollbar theming now covers About, MCP, and export/snippet surfaces consistently, and the About dialog layout was tightened so desktop builds stay compact without full-window scrolling.

## [2.1.0] - 2026-04-04

### Added

- **Desktop About window** — Added a custom About dialog with build/runtime metadata, credits, dependency inventory, product links, and native Help-menu integration so desktop builds expose release information inside the app instead of only through Settings.
- **Architecture enforcement** — Added a formal architecture budget, dependency-cruiser rules, and source generation for injected snippets so new development is constrained away from giant root modules and flat dumping-ground folders.

### Changed

- **Full frontend architecture refactor** — Removed root runtime entrypoint drift by moving app boot into `src/app/main-entry.js`, relocating the MCP frontend bridge under `src/app/platform/mcp/`, grouping runtime/export/session/console/editor code by domain, and converting injected snippets into source-backed modules that are generated for runtime consumption.
- **Console mode flow** — The runtime strip console control now acts as open/close only, while the console header uses a compact `Events` / `JS` toggle for mode switching.
- **About dialog presentation** — The desktop About surface now uses a compact non-scrolling desktop layout, two-row product links, selectable value fields, and a dependency list that scrolls internally without forcing the whole dialog to scroll.

### Fixed

- **JavaScript Console follow behavior** — JS `FOLLOW` now tracks the real Eruda transcript container, re-engages correctly, and no longer jumps to an empty viewport instead of the visible transcript.
- **Runtime and MCP strip state** — Fixed runtime/MCP indicator regressions introduced during the refactor so the strip reflects the actual loaded runtime and live MCP connection state again.
- **Event console cyclic payload crash** — Event-log rendering now handles cyclic MCP payloads safely instead of crashing on `JSON.stringify` when command metadata contains self-references.
- **Desktop About integration** — Native `About Rive Animation Viewer` now opens the custom dialog reliably, centered and styled to match the RAV desktop aesthetic.
- **Windows shell polish** — Windows startup now uses opaque dark chrome so the native menu bar remains visible in dark mode, and the bundled MCP sidecar launches without opening a stray PowerShell window.
- **Windows release workflow** — Fixed the architecture-budget checker to resolve its config path with `fileURLToPath(import.meta.url)` instead of a raw file-URL pathname, which was producing invalid `D:\\D:\\...` paths on GitHub's Windows runners and aborting the release before the Windows artifact built.

## [2.0.5] - 2026-04-03

### Fixed

- **Windows release build regression** — The stable MCP launcher-path helper now compiles correctly on Windows, unblocking cross-platform release publishing after the 2.0.4 tag failed its Windows job.

## [2.0.4] - 2026-04-03

### Added

- **`rav_configure_workspace` MCP tool** — Agents can now idempotently open or close the left and right sidebars, switch the live runtime between `internal` and `editor` source modes, and inject or remove the VM Explorer snippet without UI clicking or state guessing.

### Changed

- **Stable MCP launcher path** — The MCP Setup dialog now publishes a stable client launcher path (`rav-mcp-rav`) instead of pointing clients at the app-bundle-internal binary path, so Codex and Claude integrations survive app replacements more reliably.
- **Auto-update retry behavior** — Desktop updater failures no longer leave the chip stranded in `UPDATE RETRY`; the app now retries on timer, focus return, visibility return, and network reconnection.
- **Release/docs sync** — README, MCP server docs, website docs, and homepage feature cards now describe the 2.0.4 MCP/Claude compatibility fixes and 31-tool surface.

### Fixed

- **App-side MCP startup attach** — Packaged apps now load the frontend bridge as a real ES module, so the running app actually attaches to the bundled bridge sidecar on launch instead of leaving the sidecar listening with no live RAV connection behind it.
- **Claude MCP health-check compatibility** — The native `rav-mcp` sidecar now accepts both standard `Content-Length` MCP framing and Claude's newline-delimited JSON probe format, which fixes Claude's `Failed to connect` health checks.
- **Claude/Codex launcher install path** — One-click MCP setup now installs clients against the stable launcher shim rather than the app-bundle resource path, avoiding stale registrations after app updates.

## [2.0.3] - 2026-04-03

### Changed

- **JavaScript console presentation normalization** — Command, result, warning, error, and application log rows now share the same timestamp-and-badge chrome while preserving Eruda's native lazy object inspection for live runtime objects.
- **Console transcript copy fidelity** — Copy now serializes exactly the rows currently visible in the JavaScript console, in the same newest-first order and with the same badges shown on screen.
- **Documentation refresh** — README, website docs, and homepage feature cards were updated to reflect the normalized JS console behavior and current 2.0.x feature set.

### Fixed

- **JS console filter behavior** — Level and search filters now operate on the rendered JavaScript console transcript instead of Eruda's internal filter API, so REPL command/result rows no longer bypass filtering.
- **JS console spacing consistency** — Timestamp, badge, and message spacing is now consistent across REPL entries and app-generated log lines.

## [2.0.2] - 2026-04-03

### Changed

- **Toolbar control layout refinement** — Moved the runtime renderer selector into the central playback/layout control cluster, tightened the `OPEN` button to icon-plus-label width, and kept the primary file-open affordance bright green instead of dimming it while no file is loaded.
- **Default workspace layout** — The app now starts with the right properties panel open while the editor and console stay closed by default, matching the streamlined inspection-first workflow.
- **Console action affordances** — Event Console and JavaScript Console now use outlined SVG icon buttons for `FOLLOW`, `COPY`, and `CLEAR`, with consistent button ordering after the search field and clearer active-state styling.
- **Console chip styling** — `MCP` and `OPEN CONSOLE` in the runtime strip now use the same rectangular outlined button language as the rest of the UI instead of pill chips.
- **MCP setup responsiveness** — The MCP Setup dialog now paints immediately and refreshes its install-state data asynchronously, avoiding the perceived hang when opening the menu.
- **Help menu destination** — The native Help menu now opens the live online RAV documentation instead of leaving Help unbound.
- **Playback naming fidelity** — Playback selectors now display authored animation and state machine names exactly as they exist in the `.riv` file, without injected `SM:` display prefixes or rewritten capitalization.

### Fixed

- **MCP client detection state** — MCP setup detection now distinguishes between a client being installed, missing, or available for reinstall/removal rather than only reporting that the application executable exists.
- **Console copy support** — Event Console now has clipboard copy parity with the JavaScript Console through a dedicated copy action.
- **Initial console visibility** — Closed-console startup no longer leaves the full console chrome visible; only the runtime strip remains until the console is opened.

## [2.0.1] - 2026-04-02

### Fixed

- **Updater install handoff** — Desktop update installation now reuses the already-checked update payload instead of performing a second network check before install, which avoids stale-state failures and makes the relaunch path more reliable.
- **Updater check timeout** — Added an explicit desktop updater timeout so the update chip no longer waits indefinitely when the update endpoint is slow or unavailable.
- **CI release sidecar packaging** — The native `rav-mcp` sidecar build now creates the Tauri `src-tauri/resources` directory before Cargo evaluates the app package, fixing cross-platform release workflow failures in fresh CI checkouts.
- **Updater signing configuration** — Provisioned a valid Tauri updater signing keypair and GitHub Actions secrets for the 2.0.1 release path so updater artifacts can be signed and published successfully.
- **Merged updater manifests** — Release publishing now produces a single `latest.json` feed that carries Apple Silicon, Intel macOS, and Windows entries together instead of leaving the updater endpoint stuck on the last publishing job.
- **Installed-app patch validation** — Verified the signed desktop updater end to end by installing `2.0.0` into `/Applications`, updating to `2.0.1`, relaunching, and confirming the relaunched app reports `available: false`.

## [2.0.0] - 2026-04-02

### Added

- **Bundled native `rav-mcp` sidecar** — Packaged desktop builds now ship with a Rust `rav-mcp` binary, so end users no longer need Node.js to use MCP.
- **One-click MCP client setup** — The MCP Setup dialog now detects Codex, Claude Code, and Claude Desktop, reports whether `rav-mcp` is already installed there, and exposes `ADD`, `REINSTALL`, and `REMOVE`.
- **Configurable MCP bridge port** — The bridge port is now configurable from the MCP Setup dialog and all generated snippets/install actions stay in sync with the selected port.
- **MCP `Script Access` toggle** — JavaScript execution through MCP is now explicitly gated behind a dedicated toggle. Read-only control tools remain available even when script access is disabled.
- **Native JS transcript console** — The JavaScript console is now a first-class RAV console with timestamps, newest-first ordering, filters, search, and `FOLLOW`.
- **Unified console follow behavior** — Both Event Console and JavaScript Console now expose a sticky `FOLLOW` toggle that auto-disables when you scroll away from the latest message and re-enables when you return.
- **`generate_web_instantiation_code` MCP tool** — Generates canonical web-instantiation snippets for either CDN or local-package usage based on the exact live animation state.
- **Snippet & Export Controls dialog** — New in-app dialog for previewing snippets, choosing package source, and selecting which ViewModel and state-machine values are serialized into snippets and exported demos.
- **Selectable control export** — Branch-level checkboxes select nested control groups, leaf checkboxes select individual controls, and untouched dialogs default to the changed-control set.
- **Exported demo toolbar code copy** — Exported demos now include a `Copy Instantiation Code` action and bundle the current canonical snippet variants.
- **`window.ravRive` helper API in snippets** — Generated snippets and exported demos now expose helper methods for applying snapshots, reading VM paths, setting values, firing triggers, and accessing state machine inputs.
- **Desktop updater flow** — Added background update checks, update chip states, install/relaunch commands, updater plugin wiring, and release-workflow support for signed updater artifacts.
- **Desktop open-file coverage** — Added explicit tests for drag/drop, open-with, double-click, URI-list payloads, and startup file handoff.

### Changed

- **Major UI refresh** — The editor header, runtime strip, consoles, MCP dialog, and export flow were refined into the new 2.0.0 interaction model.
- **Editor live-source signaling** — The editor title block now acts as the live-source indicator. Neutral gray means internal wiring is active; green/pulsing means the applied editor config is driving the runtime.
- **Apply action styling** — The script editor now uses a dedicated `APPLY` action with neon emphasis instead of a subtle icon-only affordance.
- **Console toggle behavior** — The runtime strip now exposes a simpler open/close console affordance and hides the console toolbar entirely while the console is closed.
- **Unified console direction** — Event Console and JavaScript Console now grow in the same direction, use the same timestamp format, and present the newest entry at the top.
- **Layout controls surfaced** — Fit and alignment controls moved into the primary toolbar next to playback controls and are mirrored into exported demos.
- **Snippet generation semantics** — Snippets now emit organized override blocks instead of giant value dumps, round floating-point numbers to 2 decimals, and include enum option comments plus startup trigger lists.
- **Demo export semantics** — Exports now mirror the live source mode, current artboard/playback selection, selected control snapshot, fit/alignment toolbar placement, and instantiation snippet variants.
- **MCP setup messaging** — Simplified setup status to `MCP ready` / `MCP disabled`, removed outdated Node wording, and clarified the difference between bridge readiness and active client connection.
- **MCP bridge resilience** — Hardened bridge reconnect behavior, initial sidecar handshake timing, fresh-stdio first-call behavior, and post-reload reconnect persistence.
- **Resizing behavior** — Sidebars and console resize more smoothly by deferring expensive canvas resizes until the drag completes and widening the drag hit targets.
- **Runtime version picker** — Fallback runtime versions are now derived from the latest available versions instead of being hardcoded.
- **Build pipeline** — `npm run build` now compiles the native `rav-mcp` sidecar before the frontend dist build, and packaged apps bundle/sign the sidecar automatically.
- **Architecture** — `app.js` was reduced to a composition root by extracting runtime loading, export, shell/status, VM controls, transparency, state machine defaults, and other subsystems into focused modules.

### Fixed

- **Black-window startup trap** — Dev startup now fails fast when the Vite port is occupied instead of launching a transparent shell against the wrong port.
- **MCP setup detection** — Corrected false “Node not detected” messaging, broken install button behavior, and stale setup-state reporting.
- **MCP reconnect race** — Fixed the bridge race that produced `InvalidStateError` during handshake when the app and sidecar connected simultaneously.
- **First-call MCP write failures** — Fresh stdio MCP sessions now wait for the app bridge before failing write commands, preventing `RAV is not connected` on the first `rav_set_editor_code` / `rav_apply_code`.
- **Exported HTML script escaping** — Fixed broken standalone demos caused by unescaped `</script>` content inside generated config/snippet payloads.
- **Manual export parity** — Manual exports and MCP-triggered exports now use the same snippet/export builder path.
- **Autoplay on file load** — File picker, drag/drop, open-with, and MCP file loads now consistently autoplay on open.
- **Snippet/export tree UX** — Nested branches remain open while you check or uncheck child controls in the Snippet & Export Controls dialog.
- **Bridge-side object URL cleanup** — Added final object-URL cleanup for open-file sessions.
- **Runtime version picker injection risk** — Replaced unsafe `innerHTML` option interpolation for custom runtime versions.
- **`rav_get_event_log` ordering** — Event log reads now return the newest matching entries first.
- **`rav_status` detail completeness** — Status now includes alignment and the active instantiation mode/draft state.
- **ViewModel trigger resume logic** — Corrected paused/playing detection used around VM trigger behavior.
- **FOUC and panel state mismatches** — The shell layout now avoids initial panel-state flashes and keeps the UI state aligned with the DOM defaults.
- **Desktop drag targets** — Sidebar and console resize hit zones are more forgiving and less jerky.
- **Code coverage regressions** — Recovered full green tests around the new modularized controllers, export flow, MCP bridge, open-file path, updater flow, and console behavior.

## [1.9.9] - 2026-04-01

### Fixed

- **Text selection blocked on UI chrome** — Drag-select is now disabled across all UI labels, headers, buttons, and panel text. Selection remains enabled in editable fields (inputs, textareas, script editor) and copyable areas (MCP snippet blocks, server path).
- **Server path wraps and is copyable** — The MCP Setup dialog server path is now displayed as a wrapping snippet block with its own copy button, matching the other snippet sections. No more horizontal scrolling or truncation.
- **VM Explorer inject button hidden** — The terminal icon in the script editor toolbar is hidden until the browser console feature is rolled out. The underlying `injectCodeSnippet()` function is preserved.
- **Apply & Reload tooltip** — Updated to "Apply editor config and reload animation" for clarity.

### Added

- **Apply & Reload documentation** — Full docs section on the website under Configuration explaining the button's purpose, workflow, and all supported Rive constructor options (artboard, stateMachines, animations, autoplay, autoBind, layout, callbacks).

### Changed

- Bumped app/package/runtime version from `1.9.8` to `1.9.9`.

## [1.9.8] - 2026-03-31

### Fixed

- **MCP Setup dialog clipped at top** — Removed `position: fixed` + `transform` centering that conflicted with native `<dialog>` positioning. Now uses `margin: auto` (the correct method for `<dialog>` elements), which centers the dialog properly without clipping the header.
- **Dialog header visible** — The "MCP Setup" title and close button are now always visible at the top of the dialog. The body scrolls independently below it.

### Changed

- Bumped app/package/runtime version from `1.9.7` to `1.9.8`.

## [1.9.7] - 2026-03-31

### Fixed

- **MCP Setup dialog centered** — Dialog now opens centered on screen using `position: fixed` with `translate(-50%, -50%)` instead of default browser dialog positioning.
- **Server path fully visible** — Path row now scrolls horizontally and text is selectable, no longer truncated with ellipsis.
- **Copy button repositioned** — Copy buttons moved to a header bar above each snippet block so they never overlap or obscure code text.
- **Sticky dialog header** — The MCP Setup title bar with close button stays pinned at the top when scrolling through the snippet list.
- **Node.js status indicator** — Shows green dot + "installed" when MCP bridge is connected (confirms Node.js is working), or red dot + "not detected" with an INSTALL button linking to nodejs.org when not detected.

### Changed

- Bumped app/package/runtime version from `1.9.6` to `1.9.7`.

## [1.9.6] - 2026-03-31

### Fixed

- **CI build failure** — MCP server bundler now auto-installs its npm dependencies before esbuild runs, fixing the Windows/macOS CI builds that failed because `mcp-server/node_modules` wasn't present.

### Changed

- Bumped app/package/runtime version from `1.9.5` to `1.9.6`.

## [1.9.5] - 2026-03-31

### Added

- **MCP Setup dialog** — New in-app dialog (cable icon in toolbar) with ready-to-copy configuration snippets for Claude Code, Claude Desktop, OpenAI Codex/ChatGPT, and generic MCP clients. No repo cloning or npm install required.
- **Bundled MCP server** — The MCP server is now compiled into a single self-contained .js file (831KB, zero dependencies) and shipped inside the app bundle as a Tauri resource. Users only need Node.js installed.
- **Tauri `get_mcp_server_path` command** — Returns the absolute path to the bundled MCP server for use in setup snippets.
- **esbuild MCP bundler** (`scripts/bundle-mcp-server.mjs`) — Bundles the MCP server + all npm dependencies into one file at build time.

### Changed

- Bumped app/package/runtime version from `1.9.4` to `1.9.5`.
- Build script now runs MCP server bundling before dist build.
- MCP documentation rewritten across README, website docs, and MCP server README to be user-friendly for non-developer users.

## [1.9.4] - 2026-03-31

### Fixed

- **MCP setup documentation** — Rewrote MCP setup instructions across docs page, README, and MCP server README to be user-friendly for people who downloaded the desktop app (not just repo contributors). Added prerequisite info (Node.js 18+), clone step, explanation of what MCP is, and a "how it works" section.
- **Website changelog** — Fixed stale web/CHANGELOG.md that was not being synced from the root changelog, causing the website to show outdated version history.

### Changed

- Bumped app/package/runtime version from `1.9.3` to `1.9.4`.
- Website feature cards now show 14 features including Artboard Switcher.
- Website docs include full Artboard Switcher documentation section.

## [1.9.3] - 2026-03-31

### Fixed

- **Export cancel no longer shows error** — Dismissing the native save dialog without saving now shows "Export cancelled." in the info strip instead of a red error banner. Cancellation is detected by checking for "cancel" in the Tauri error message.

### Changed

- Bumped app/package/runtime version from `1.9.2` to `1.9.3`.

## [1.9.2] - 2026-03-31

### Fixed

- **VM Instance selector scoped to current artboard** — The VM Instance dropdown now only shows instances belonging to the current artboard's own ViewModel definition (via `defaultViewModel()`). Previously it incorrectly enumerated ALL ViewModel definitions across the entire file, polluting the dropdown with unrelated instances from other artboards and nested VMs.
- **VM Instance switching** — Selecting an instance from the dropdown now correctly calls `bindViewModelInstance()` on the current artboard's ViewModel definition and re-renders the VM controls with that instance's values. Removed the broken composite key format.
- **VM section label casing** — Section labels now preserve the exact original spelling from the ViewModel (lowercase, dashes, special characters). The forced `toUpperCase()` call was removed.

### Changed

- Bumped app/package/runtime version from `1.9.1` to `1.9.2`.

## [1.9.1] - 2026-03-31

### Fixed

- **ViewModel section label** — The root VM section now shows the actual ViewModel name (e.g. "RIGHT-BADGE-UNIT-VM") instead of the hardcoded "Root VM". Uses `viewModelName` or `name` from the ViewModel instance.
- **One-shot animation replay** — Pressing Play on a finished one-shot animation now restarts it from the beginning instead of doing nothing. Calls `stop()` then `play(animationName)` when the animation has ended.
- **VM instance selector** — Fixed the VM Instance dropdown never populating. `instanceCount` and `instanceNames` are properties (not functions) on the Rive ViewModel definition. The selector now correctly enumerates named instances and supports switching via `instanceByName()` or `instanceByIndex()`.

### Changed

- Bumped app/package/runtime version from `1.9.0` to `1.9.1`.
- VM instance switching now tries `replaceViewModel()` as a fallback if `setViewModelInstance()` is not available.

## [1.9.0] - 2026-03-31

### Added

- **Artboard / Animation Switcher** — New collapsible control section in the Properties panel with two auto-populating dropdowns:
  - **Artboard selector** — lists all artboards in the loaded .riv file
  - **Playback selector** — lists state machines (prefixed "SM:") and timeline animations for the selected artboard
  - **VM Instance selector** — appears when multiple ViewModel instances are available
  - **Default button** — resets to the default artboard and state machine detected on first load
- Switching artboard or playback target auto-plays immediately and re-populates ViewModel controls for the new artboard.
- Export now captures the exact artboard/animation setup shown in the viewer, including animation-only playback targets.
- **MCP tools**: `rav_switch_artboard` and `rav_reset_artboard` for remote artboard/animation control.
- `rav_status` now includes `artboard` state (current artboard, playback type/name, defaults, file contents).

### Changed

- Bumped app/package/runtime version from `1.8.1` to `1.9.0`.
- `loadRiveAnimation` now accepts `configOverrides` parameter for programmatic artboard/playback switching without modifying the script editor.
- `DemoBundlePayload` (Rust) now includes `animations` field alongside `state_machines` for animation-only exports.

## [1.8.1] - 2026-03-31

### Fixed

- **MCP artboard/state machine tools** — `rav_get_artboards` and `rav_get_state_machines` now correctly read `contents`, `stateMachineNames`, and `animationNames` as properties (not function calls), returning full artboard data including animations and state machines.
- **MCP ViewModel tree** — `rav_get_vm_tree` now reads `viewModelInstance` directly from the Rive instance instead of depending on the vm-explorer-snippet injection. Returns property kinds, paths, and current values out of the box.
- **MCP vm_get/vm_set/vm_fire** — All ViewModel accessors now fall back to direct `viewModelInstance` property access with path navigation for nested ViewModels, removing the hard dependency on the vm-explorer-snippet.
- **MCP trigger firing** — `rav_vm_fire` now calls `.trigger()` (the correct Rive VM accessor method) instead of the nonexistent `.fire()`.
- **MCP SM input tools** — `rav_get_sm_inputs` and `rav_set_sm_input` read `stateMachineNames` as a property.

### Added

- **MCP dialog-free export** — `rav_export_demo` now accepts an optional `output_path` parameter that saves the demo HTML directly to disk without opening a native save dialog. Uses a new Tauri `make_demo_bundle_to_path` command. Without `output_path`, the original dialog-based flow is preserved.
- **MCP agent instructions** — The MCP server now sends comprehensive usage instructions on connect, covering recommended workflow, Rive API gotchas (properties vs functions, `.trigger()` not `.fire()`), ViewModel path format, and debugging tips.
- **MCP indicator three-state design** — The runtime strip MCP chip now shows three distinct visual states: OFF (very dim, bridge disabled), WAITING (dim indigo with pulsing dot, looking for agent), CONNECTED (bright indigo with glow). Clickable to toggle bridge on/off.
- **MCP indicator repositioned** — Moved to the left side of the runtime strip before the runtime dot so long filenames cannot clip it.

### Changed

- Bumped app/package/runtime version from `1.8.0` to `1.8.1`.

## [1.8.0] - 2026-03-31

### Added

- **MCP Server** (`mcp-server/`): Model Context Protocol server that exposes 31 tools for controlling RAV from Claude Code or any MCP client — open files, inspect ViewModels, drive playback, manipulate inputs, configure the workspace, read event logs, edit scripts, and export demos.
- **MCP Bridge** (`mcp-bridge.js`): Frontend WebSocket client that auto-connects to the MCP server's bridge on `ws://127.0.0.1:9274` with exponential backoff reconnection.
- **MCP connection indicator** in the runtime strip — a dot + "MCP" chip that lights up indigo when the bridge is connected.
- **MCP event filter** in the event console — a new "MCP" toggle button alongside Native/Rive User/UI filters, with indigo accent color.
- **Formatted MCP event logging** — all MCP commands, responses, connections, and errors are logged to the event console with human-readable summaries (no raw JSON), elapsed time, and structured result formatting.

### Changed

- Bumped app/package/runtime version from `1.7.6` to `1.8.0`.
- Build dist script now includes `mcp-bridge.js` in the distribution bundle.

## [1.7.6] - 2026-02-23

### Changed

- Bumped app/package/runtime version from `1.7.5` to `1.7.6`.
- Build numbering now auto-increments per local build using a persisted counter (`.cache/build-counter.txt`) instead of staying pinned to git commit count.

### Fixed

- Restored reliable desktop drag/drop file opening by handling window-level drop payloads and fallback URI/path payloads (`text/uri-list` / `text/plain`) in the frontend.
- Added native Tauri drag/drop forwarding (`WindowEvent::DragDrop`) to the existing open-file handoff path, so `.riv` drops are received even when browser-style file payloads are absent.

## [1.7.5] - 2026-02-23

### Changed

- Bumped app/package/runtime version from `1.7.4` to `1.7.5`.
- Added runtime semver selector in Settings with `Latest (auto)` plus the latest 3 prior versions and a `Custom` option.
- Runtime build identifiers now use local system time (instead of UTC) for easier test-build verification.

### Fixed

- Resolved runtime `latest` alias handling so `Latest (auto)` resolves to a concrete semver before cache/load (matching direct semver selection behavior).
- Added per-file runtime semver persistence so each `.riv` remembers its selected runtime version.
- Exported standalone demos now embed the exact selected runtime semver.
- Runtime custom version input row now appears only when `Custom` is selected.
- Default playback target selection now pre-detects state machines before instantiation (avoids unintended first-animation fallback when no playback target is specified).

## [1.7.4] - 2026-02-15

### Changed

- Bumped app/package/runtime version from `1.7.3` to `1.7.4`.

### Fixed

- VM string inputs now default to a single visible row and automatically expand to two rows only when multiline content is present.
- State machine controls are now flattened to a single group per state machine (no extra nested "State Machines" wrapper), and only rendered when that state machine has inputs.

## [1.7.3] - 2026-02-15

### Changed

- Bumped app/package/runtime version from `1.7.2` to `1.7.3`.

### Fixed

- VM string inputs now use multiline text areas so line breaks are preserved when rendering existing values.
- Editing string inputs no longer collapses multiline text into a single line.

## [1.7.2] - 2026-02-15

### Changed

- Bumped app/package/runtime version from `1.7.1` to `1.7.2`.

### Fixed

- Corrected state-machine input type detection so boolean and number inputs are not misclassified as triggers.
- Trigger controls now fire only actual trigger inputs, restoring expected state-machine transitions and related input updates.

## [1.7.1] - 2026-02-14

### Changed

- Bumped app/package/runtime version from `1.7.0` to `1.7.1`.
- Exported demo bundles now persist active player layout state (panel sizes/visibility, event console collapse/filter state, and transparency-related settings) from the moment export is triggered.
- Continued build traceability with numbered build identifiers (`bNNNN-YYYYMMDD-HHMM-<gitsha>`) for test installs.

### Added

- New `No BG` control to return canvas background to transparent mode.
- New `Transparency` mode toggle in player settings.
- New desktop `Click Through` toggle (best-effort transparent-pixel passthrough sampling).

### Fixed

- Demo export hydration now restores right-panel width/visibility and event-console layout state instead of always using defaults.
- Desktop click-through transparency now uses continuous cursor-position sync (no pulse mode), reducing focus flapping and improving pass-through reliability.
- Reset control now performs a full autoplay-style reload instead of leaving playback stopped.
- VM/state-machine property values set in the Properties panel are now captured and restored after reset/restart (trigger inputs excluded).
- Exported demo template now disables transparency toggle UI to avoid exposing a non-functional desktop-only control.

## [1.7.0] - 2026-02-13

### Changed

- Bumped app/package/runtime version from `1.6.3` to `1.7.0`.
- Updated docs and release notes for current runtime and UI behavior.

### Fixed

- Event console filter toggles now remain single-line in narrow layouts (prevents `RIVE USER` wrapping).
- Refreshed app icon assets across desktop/mobile icon sets in repository.

## [1.6.3] - 2026-02-13

### Changed

- Bumped app/package/runtime version from `1.6.2` to `1.6.3`.

### Fixed

- VM and state-machine control UI now continuously syncs live runtime values, including booleans changed by animation/listener logic.
- Preserved in-progress user edits while syncing by skipping active focused inputs.

## [1.6.2] - 2026-02-13

### Changed

- Bumped app/package/runtime version from `1.6.1` to `1.6.2`.

### Fixed

- Hardened Tauri v2 frontend bridge resolution for packaged builds by supporting `window.__TAURI_INTERNALS__.invoke`.
- Prevented broken bare-module bridge imports in packaged protocol mode (`tauri://`) and restricted module imports to local dev server usage.
- Kept open-file polling active in desktop mode so newly opened `.riv` files are detected reliably even when event listeners are unavailable.
- Switched native pending open-file state to a queue (not single slot), preventing dropped files when multiple open events arrive quickly.
- Added single-instance argument forwarding in Tauri so double-click/open-in arguments are forwarded and focused into the running app.

## [1.6.1] - 2026-02-13

### Added

- Visible app build identifier in the runtime info strip (`build YYYYMMDD-HHMM-<gitsha>`).
- Build metadata injection in `npm run build`, including UTC timestamp + git short SHA.

### Changed

- Bumped app/package/runtime version from `1.6.0` to `1.6.1`.
- Version panel now shows both release and build identifier.

### Fixed

- Improved cold-launch file handoff reliability for `.riv` open events in Tauri v2 by:
  - persisting pending opened-file state in Rust,
  - emitting `open-file` at app scope,
  - adding frontend polling fallback for startup race conditions.

## [1.6.0] - 2026-02-13

### Added

- Dynamic VM input control generation for all discovered ViewModel inputs with nested, collapsible sections.
- State machine input support (legacy control schema) for number, boolean, and trigger inputs.
- Multi-source event console filtering with independent toggles (`Native`, `Rive User`, `UI`) plus text search.
- Desktop open-file flow support for `.riv` files via system open actions (`Open With`, double-click association launch path handling).
- Embedded VM hierarchy payload support in exported standalone demo bundles.

### Changed

- Upgraded app release versioning to `1.6.0` across frontend and Tauri package manifests.
- Default startup layout now opens with the code editor panel hidden.
- VM control tree defaults to root open, with nested ViewModels and state-machine groups collapsed by default.
- Event drawer resize now triggers immediate canvas redraw/resizing to prevent squashed rendering.
- Event log UI changed from single-select source dropdown to multi-toggle filters and search-first workflow.
- Opened-file path normalization improved for `file://` URIs, quoted paths, and Windows-style path separators.

### Fixed

- Trigger execution reliability for VM/state-machine controls by resolving accessors per-control-source.
- Root VM duplicate-input suppression now keys by full input path (not name only), preventing accidental hidden controls.
- File-open error handling robustness for invalid/empty open-file payloads.
- Runtime resize consistency during panel drag and panel visibility transitions.

## [1.5.0] - 2026-02-11

### Added

- Introduced redesigned player shell aligned to the design system direction.
- Added nested VM control presentation and event console surface as part of redesign baseline.

### Changed

- Updated layout structure to support collapsible side panels and expanded control density.

## [1.4.3] - 2025-11-19

### Changed

- Bumped manifests to `1.4.3`.
- Stabilized release automation triggering from commit subject parsing.

## [1.4.2] - 2025-11-19

### Fixed

- Corrected VM Explorer type detection edge cases.
- Reduced source map warning noise in app/runtime output.

## [1.4.1] - 2025-11-19

### Fixed

- Improved UI flexibility and code organization for desktop/player surfaces.

## [1.4.0] - 2025-11-19

### Added

- CodeMirror 6 script editor integration.
- VM Explorer tooling and helper command injection for runtime inspection.
- Expanded developer-focused workflow in app UI.

## [1.3.0] - 2025-11-18

### Added

- Fullscreen mode with improved user experience.
- Fullscreen support in exported demo flow.

## [1.2.6] - 2025-11-11

### Changed

- Bumped manifests to `1.2.6`.
- Consolidated latest build and packaging updates into patch release.

## [1.2.5] - 2025-11-11

### Fixed

- Verified ad-hoc signing flow for separated architecture builds.
- Hardened macOS CI packaging behavior.

## [1.2.4] - 2025-11-11

### Fixed

- Prevented CI double-build by explicitly setting `tauriScript` in workflow.

## [1.2.3] - 2025-11-11

### Changed

- Improved release documentation and user-facing download instructions.

## [1.2.2] - 2025-11-11

### Changed

- Bumped manifests to `1.2.2`.
- Aligned patch release process with local versioning scripts.

## [1.2.1] - 2025-11-11

### Added

- Local version bump workflow and pre-push enforcement tooling.
- Version synchronization scripts across `package.json`, Tauri config, and Cargo.

## [1.2.0] - 2025-11-11

### Added

- Build and distribution optimizations for packaged desktop output.
- Service worker and build pipeline updates for improved artifact behavior.

## [1.1.7] - 2025-11-11

### Changed

- Optimized build size and architecture handling for release artifacts.

## [1.1.6] - 2025-11-11

### Fixed

- Enabled full bundle target generation for Windows installers.

## [1.1.5] - 2025-11-11

### Fixed

- Improved release workflow permissions and reliability for creating release artifacts.

## [1.1.4] - 2025-11-11

### Fixed

- Added `package-lock.json` support to stabilize npm cache behavior in CI.

## [1.1.3] - 2025-11-11

### Changed

- Standardized automated patch bump workflow and release commit handling.

## [1.1.2] - 2025-11-11

### Added

- Initial semantic-version CI/CD release automation.

### Fixed

- Cargo.lock handling in automated bump flow.
- Permissions for workflow write operations.

## [1.1.1] - 2025-11-11

### Fixed

- Demo bundle button behavior and Tauri integration stability.
- Template defaults (`autoBind`) in exported demo HTML.

## [1.1.0] - 2025-11-11

### Added

- Standalone demo bundle generation with embedded HTML export.

## [1.0.0] - 2025-11-11

### Added

- Initial Rive Animation Viewer foundation.
- Baseline desktop wrapper, runtime loading, and demo-bundle infrastructure.
