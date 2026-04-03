# Architecture Guardrails

This repo needs enforced structural discipline. The goal is not just "clean code"; it is to make ongoing feature work possible without drifting back into 900- to 1600-line files or dumping unrelated modules into a single folder.

## Hard Rules

### 1. Source file size

- Hand-written runtime source files have a hard default ceiling of `400` lines.
- New source files may not exceed `400` lines.
- Existing oversized files are grandfathered temporarily and are locked by budget in [architecture-budget.json](/Users/ivg/github/rive-animation-viewer-audit-20260401/architecture-budget.json).
- Grandfathered files may not grow. Any increase fails the architecture check.

### 2. Folder fan-out

- A leaf source folder should start splitting into subgroup folders at `8` direct source files.
- A leaf source folder may not exceed `10` direct source files.
- If a folder is approaching that limit, create logical subgroups before adding more siblings.

### 3. Composition roots stay thin

- Entrypoints should compose controllers and wire dependencies.
- Entrypoints should not absorb new business logic.
- `app.js`, `mcp-bridge.js`, and `main.rs` should trend downward over time, not upward.

### 4. Add by extraction, not accretion

When a file is already large:

- do not append another feature block to it by default
- extract the new concern into a sibling module or subgroup folder first
- leave the original file as orchestration/glue

## Source Layout Strategy

Current top-level app folders are fine, but future work should branch into subgroups instead of remaining flat forever.

### `src/app/core`

Keep flat unless a second distinct concern appears. This folder should remain small.

### `src/app/platform`

Use subgroup folders when concerns multiply:

- `platform/export/`
  - demo export assembly
  - web instantiation generation
  - snippet formatting helpers
- `platform/mcp/`
  - bridge transport
  - tool handlers
  - connection state / status mapping
- `platform/runtime/`
  - runtime loading
  - runtime version selection
  - package/version utilities
- `platform/session/`
  - file loading
  - drag/drop
  - desktop open-file handoff
- `platform/desktop/`
  - updater
  - Tauri interop helpers

### `src/app/ui`

Split by surface, not by generic utility:

- `ui/console/`
  - JS console
  - event console
  - transcript rendering
  - follow/filter/copy behaviors
- `ui/editor/`
  - code editor
  - live source state
  - VM explorer injection helpers
- `ui/mcp/`
  - MCP setup dialog
  - install-state detection
  - Script Access / port settings
- `ui/layout/`
  - shell controller
  - resizing logic
  - sidebar open/close state
- `ui/export/`
  - snippet/export controls dialog

### `src/app/rive`

Split by runtime concern:

- `rive/artboards/`
  - artboard and playback selection
  - default artboard restore
- `rive/playback/`
  - play/pause/reset
  - current playback state
- `rive/view-model/`
  - traversal
  - descriptor/snapshot serialization
  - control UI bindings
- `rive/instance/`
  - instance construction
  - reload behavior
  - resize coordination

### `src-tauri/src`

Rust should follow the same rule:

- `src-tauri/src/bin/rav-mcp/`
  - protocol parsing
  - stdio transport
  - tool registry
  - app bridge client
- `src-tauri/src/app/`
  - updater commands
  - sidecar management
  - file/open routing

## Decision Rules For New Work

Before adding code to an existing file, apply these checks:

1. Is the target file already over `300` lines?
   Then default to extracting a sibling module.

2. Does the new code introduce a new noun/domain?
   Create a new module for that domain instead of placing it in a generic file.

3. Are three or more files in a folder sharing a common prefix/theme?
   Create a subgroup folder and move them under it.

4. Is the file mostly orchestration plus one large helper block?
   Extract the helper block immediately.

5. Will the new feature require its own tests?
   Put the implementation behind a dedicated module boundary first.

## Enforcement

Architecture enforcement is automated by:

- [architecture-budget.json](/Users/ivg/github/rive-animation-viewer-audit-20260401/architecture-budget.json)
- [scripts/check-architecture.mjs](/Users/ivg/github/rive-animation-viewer-audit-20260401/scripts/check-architecture.mjs)
- [.dependency-cruiser.cjs](/Users/ivg/github/rive-animation-viewer-audit-20260401/.dependency-cruiser.cjs)

The checks are part of `npm run test`, so they run in local development and in builds.

What it enforces today:

- new hand-written source files cannot exceed `400` lines
- current oversized source files cannot grow past their locked budgets
- source folders cannot exceed `10` direct source files
- folders at `8+` direct source files emit warnings so subgrouping happens before the hard limit
- dependency cycles fail the build
- `core`, `platform`, `rive`, and `ui` cannot casually reach across layers or import root entrypoints

## Scope

The architecture budget is intentionally focused on hand-written runtime source.

Excluded from the hard size ceiling:

- generated files
- vendored bundles
- changelogs and content-heavy docs
- test files

That keeps the enforcement focused on maintainability of the executable codebase.
