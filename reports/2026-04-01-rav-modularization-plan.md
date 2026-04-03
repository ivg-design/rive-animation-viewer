# RAV Modularization Plan

Date: 2026-04-01
Branch: `codex/rav-codebase-audit`

## Goals

- No frontend source file over 300-500 lines.
- UI changes should be local to one module and one style slice whenever possible.
- New features should attach to explicit domains, not to `app.js` globals.
- The app should remain runnable in both Vite/web and Tauri/desktop throughout the refactor.

## Constraints

- Preserve current behavior while refactoring.
- Keep the current raw-module static bundle approach for now.
- Keep MCP behavior working during the transition.
- Avoid a big-bang rewrite.

## Target Frontend Structure

```text
app.js                          # Thin entry/bootstrap only
mcp-bridge.js                   # Thin bridge entry or imported module wrapper
style.css                       # Import-only stylesheet manifest

src/app/
  core/
    constants.js
    elements.js
    templates.js
    formatting.js
  platform/
    tauri-bridge.js
    runtime-loader.js
    runtime-versioning.js
  state/
    session-store.js
    ui-store.js
  ui/
    action-bindings.js
    panels.js
    resizers.js
    settings-popover.js
    file-loading.js
    canvas-controls.js
    event-log.js
    mcp-setup.js
    info-strip.js
    error-toast.js
  editor/
    code-editor.js
    vm-explorer-injection.js
  rive/
    animation-loader.js
    playback-controls.js
    artboard-switcher.js
    vm-controls.js
    vm-accessors.js
    state-machine-accessors.js
  mcp/
    exposed-hooks.js
```

## Target CSS Structure

```text
style.css
styles/
  00-base.css
  01-header.css
  02-settings.css
  03-workspace.css
  04-runtime-strip.css
  05-mcp-dialog.css
  06-layout-controls.css
  07-properties.css
  08-event-log.css
  09-overlays-responsive.css
```

## Refactor Order

### Phase 1: Foundation

- Move shared constants and DOM queries into `src/app/core`.
- Eliminate inline `onclick` handlers and bind UI events in JS.
- Split `style.css` into imported slices.

### Phase 2: Platform Boundaries

- Extract Tauri bridge and MCP setup dialog.
- Extract runtime versioning and runtime source resolution.
- Keep the public API identical while shrinking `app.js`.

### Phase 3: UI Domains

- Extract event log, panel toggles, settings popover, resizers, and file-loading UI.
- Centralize HTML template helpers instead of writing long `innerHTML` strings inline.

### Phase 4: Rive Runtime Domains

- Extract animation loading and cleanup.
- Extract playback controls.
- Extract artboard/playback switcher.
- Extract VM/state-machine accessors and control rendering.

### Phase 5: State Cleanup

- Replace free-floating mutable variables with explicit store objects:
  - session/runtime/file state
  - UI state
  - bridge state
- Limit what is exposed on `window` to a dedicated MCP/dev API surface.

## Size Budget

- `app.js`: <= 250 lines
- module files: <= 400 lines preferred, 500 max
- CSS slices: <= 400 lines preferred, 500 max

## First Extraction Pass In This Branch

- Split CSS into importable slices.
- Add `constants.js` and `elements.js`.
- Extract:
  - `platform/tauri-bridge.js`
  - `ui/event-log.js`
  - `ui/mcp-setup.js`
  - `ui/action-bindings.js`
- Convert top-level UI buttons away from inline handlers.

## Success Criteria

- `npm run build` still passes.
- `cargo check --manifest-path src-tauri/Cargo.toml` still passes.
- The root app entry is smaller and mostly orchestration.
- Future extractions can happen domain-by-domain without reworking the structure again.
