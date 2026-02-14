# Changelog

All notable changes to this project are documented in this file.

## [1.6.3] - 2026-02-14

### Changed

- Bumped app/package/runtime version from `1.6.2` to `1.6.3`.

### Fixed

- VM and state-machine control UI now continuously syncs live runtime values, including booleans changed by animation/listener logic.
- Preserved in-progress user edits while syncing by skipping active focused inputs.

## [1.6.2] - 2026-02-14

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
- Multi-source event log filtering with independent toggles (`Native`, `Rive User`, `UI`) plus text search.
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
