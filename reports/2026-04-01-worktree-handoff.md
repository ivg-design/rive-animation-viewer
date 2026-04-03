# RAV Audit Worktree Handoff

Workspace:
- `/Users/ivg/github/rive-animation-viewer-audit-20260401`

Branch:
- `codex/rav-codebase-audit`

Purpose:
- Audit and modularize the RAV app
- Keep files under roughly 300-500 LOC where practical
- Maintain Vitest unit/smoke coverage during refactor

Current status:
- CSS has been split into modular files under `styles/`
- Frontend modules extracted under `src/app/`
- Vitest is installed and enforced in `prebuild`
- Vitest UI is available via `npm run test:ui`
- Coverage is generated via `npm run test:coverage`
- Runtime/versioning helper logic has been extracted to `src/app/platform/runtime-utils.js`
- `app.js` now imports the extracted runtime utilities

Current test/build state:
- `npm test` passes
- `npm run build` passes
- `npm run test:coverage` passes

Latest coverage:
- Total: 89.74% statements, 72.77% branches
- `platform`: 87.5% statements, 75% branches

Important current files:
- `reports/2026-04-01-rav-codebase-audit.md`
- `reports/2026-04-01-rav-modularization-plan.md`
- `src/app/platform/runtime-utils.js`
- `tests/unit/platform/runtime-utils.test.js`
- `tests/unit/platform/tauri-bridge.test.js`
- `vitest.config.js`

Known workspace mismatch:
- Original thread workspace: `/Users/ivg/github/rive-animation-viewer`
- Original thread branch: `feature/script-console`
- Actual audit/refactor worktree: `/Users/ivg/github/rive-animation-viewer-audit-20260401`
- Actual audit/refactor branch: `codex/rav-codebase-audit`

Recommended next refactor target:
1. Extract the runtime loader/controller flow from `app.js`
2. Add/adjust Vitest coverage for each extracted module
3. Continue with editor, playback, artboard switching, and VM controls

Useful commands:
- `npm run test:ui`
- `npm run test:coverage`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
