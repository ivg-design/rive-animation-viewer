# Changelog

All notable changes to this project are documented in this file.

> Historical note: entries before `1.6.0` were reconstructed from git commit messages, manifest version bumps, and commit dates. Early repository tags around `1.1.x`-`1.2.0` were offset by the old CI bump flow; this changelog follows the actual `package.json`/Tauri manifest version history.

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
