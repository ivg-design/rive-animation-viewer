# Wave1A runtime implementation receipt

Shared checkout: `/Users/ivg/github/rive-animation-viewer`, branch `codex/v2.5.5-media-export`. Source implementation complete; no commit/push, full build, app launch, production replacement or Launch Services changes by this lane. Parent/native concurrent changes are excluded from the file inventory below.

## Implemented behavior and hooks

- `createInspectionService().inspect({buffer,sourceIdentity,runtimeKey,runtime,signal?})` copies bytes and loads an independently owned low-level file through RuntimeLoader. No live player/file is used. CDN asset fetching is disabled for inspection. SM/artboard instances and file are deleted on success/failure; a late file produced after cancellation is deleted without enumeration. Immutable plain results are bounded to eight cached source/runtime entries by default. `peek`, `clear`, `dispose` are available. Unsupported inspection fails explicitly with no probe fallback.
- Metadata: `{sourceIdentity,runtimeKey,artboards:[{name,animations:[{name,fps,durationFrames,durationSeconds,workStartFrame,workEndFrame,workAreaEnabled}],stateMachines:[{name,inputs:[{name,type}]}]}]}`. Unsupported timing is `null`; durationFrames/FPS gives authored durationSeconds, distinct from work area.
- Runtime-stack creates `inspectionController`; controller-stack provides current buffer, file preference and runtime version. Instance-controller awaits inspection before constructing the host player. Load-lifecycle clears then binds metadata before user onLoad and UI population. Root default-SM lookup reads inspected metadata instead of probing. Metadata cache lookup verifies current buffer identity, file preference and runtime key.
- Host binding API is `setInspectionMetadata(player,metadata)` / `getInspectionMetadata(player)` from `rive/runtime-compatibility.js`. Shared compatibility input metadata and UI artboard enumeration use only that data. MCP metadata fallback blocks were replaced and released to parent. Child canonical artboard names use `CONFIG.inspectionMetadata`.
- Parent-owned native payload/config plumbing and child onLoad binding remain parent responsibility: `inspection_metadata` is optional JSON in the export payload; `CONFIG.inspectionMetadata` must be the decoded object; bind after the child's clear call. No child rive-loader/native demo_bundle edits by this lane.
- `renderSurfaceController.getSourceScope()` exposes the active source/runtime/artboard/VM/session. Demo export compares active control scope with candidate scope before capture, validates source/selection across async preparation, and rehashes copied bytes (including mutations of an existing ArrayBuffer). Same-source renderer rebuild snapshots are retained. A different source, changed bytes, runtime, artboard or VM does not inherit controls. Untagged activation snapshots are not replayed.
- Activation coordinator stamps queued/direct mutations with their origin session/scope and rejects mismatched replay. Activation checks session currency before/after command awaits. Remote accessor handles cannot silently retarget a new session/artboard/VM; local pending snapshots are invalidated on source change. Root, global VM and state-machine namespaces remain distinct.
- All host roots are wired and released: platform-stack demo callbacks, controller getSourceScope, runtime-stack inspection construction, controller-stack source callbacks, rive-stack VM callbacks/default-SM lookup, instance-controller/load-lifecycle sequencing. No further Wave1A wiring is intentionally left unused.

## Exact lane source files

New:
- `src/app/rive/inspection/service.js`
- `src/app/rive/inspection/native-metadata.js`
- `src/app/rive/inspection/source-scope.js`
- `src/app/platform/runtime/inspection-controller.js`
- `src/app/platform/export/demo-payload.js`
- `src/app/platform/render-surface/activation/source-scopes.js`

Modified:
- `src/app/bootstrap/stacks/controller-stack.js`
- `src/app/bootstrap/stacks/platform-stack.js` (metadata/VM callback hooks only; released)
- `src/app/bootstrap/stacks/rive-stack.js`
- `src/app/bootstrap/stacks/runtime-stack.js`
- `src/app/platform/export/demo-export.js`
- `src/app/platform/export/render-source-identity.js`
- `src/app/platform/mcp/commands/status-playback.js` (metadata blocks/import only; parent owns later command changes)
- `src/app/platform/render-surface/activation/coordinator.js`
- `src/app/platform/render-surface/activation/transaction.js`
- `src/app/platform/render-surface/controller.js` (getSourceScope return hook only; parent owns other concurrent changes)
- `src/app/platform/render-surface/controller/activation-handler.js`
- `src/app/platform/render-surface/controller/load-operation.js`
- `src/app/rive/artboards/ui-population.js`
- `src/app/rive/instance-controller.js`
- `src/app/rive/instances/load-lifecycle.js`
- `src/app/rive/runtime-compatibility.js`
- `src/app/rive/view-model/controller.js`
- `src/app/rive/view-model/controller/accessor-resolver.js`
- `src/app/rive/view-model/remote/controls.js`
- `src/app/rive/view-model/snapshot.js`
- `src/app/snippets/source/rive-runtime-compatibility.js`
- `src/app/snippets/generated/rive-runtime-compatibility.generated.js` (regenerated)
- `src-tauri/src/demo-template/js/vm/canonical-state.js` (two metadata lines only)

Tests added:
- `tests/unit/rive/inspection/service.test.js`
- `tests/unit/rive/inspection/source-guards.test.js`
- `tests/unit/platform/export-source-guards.test.js`

Test fixtures updated:
- `tests/unit/bootstrap/controller-stack.test.js`
- `tests/unit/platform/demo-export.test.js`
- `tests/unit/platform/render-surface-activation-coordinator.test.js`
- `tests/unit/platform/render-surface-activation-transaction.test.js`
- `tests/unit/platform/render-surface-controller.test.js`
- `tests/unit/rive/artboard-switcher.test.js`
- `tests/unit/rive/runtime-compatibility-integration.test.js`
- `tests/unit/rive/runtime-compatibility.test.js`

## Verification

Final focused run: **14 files, 198 tests passed**, 4.97 seconds. Exact command:

```sh
npx vitest run tests/unit/rive/inspection tests/unit/platform/export-source-guards.test.js tests/unit/platform/demo-export.test.js tests/unit/platform/render-surface-activation-coordinator.test.js tests/unit/platform/render-surface-activation-transaction.test.js tests/unit/platform/render-source-identity.test.js tests/unit/rive/artboard-switcher.test.js tests/unit/platform/render-surface-controller.test.js tests/unit/rive/instance-controller.test.js tests/unit/rive/runtime-compatibility.test.js tests/unit/rive/runtime-compatibility-integration.test.js tests/unit/rive/remote-vm-controls.test.js tests/unit/bootstrap/controller-stack.test.js --reporter=dot
```

Other checks:
- `node scripts/check-architecture.mjs`: passed for 341 files in the concurrent checkout; existing near-cap folder warnings only. No budget relaxation. Demo-export extracted from 408 lines to 381; no grandfathered growth by this lane.
- `npx depcruise --config .dependency-cruiser.cjs mcp-server/index.js src/app`: no violations, 194 modules/322 dependencies.
- `git diff --check`: passed.
- `rg -n '\.contents\b' src/app src-tauri/src/demo-template`: zero matches after replacement. Intentional authored snapshot property names elsewhere are not reads of live `.contents`.
- Local Rive implementation reviewed: `/Users/ivg/github/rive-wasm/js/src/rive.ts` RuntimeLoader/load/getter; `rive_advanced.mjs.d.ts` ownership API; `wasm/src/bindings.cpp` timeline units/properties. No private tooling dependency.

Known limits: mocked native ownership/runtime tests establish the isolation path and cleanup contract; they do not prove TrackMap pixel stability, actual runtime-version compatibility, or long-run native memory behavior. Runtime versions missing low-level metadata are rejected instead of falling back. Same-source rebuilds retain observed scalar snapshots as before; this lane does not introduce a separate persistent user-edit provenance model. Parent owns built desktop cold-start/inspection/A-to-B/same-source acceptance, media integration, and frame/reset/image presentation tests in demo-template-vm.test.js. Those parent-owned barrier tests were not investigated or changed.

Next integration action: parent finishes/validates native metadata JSON and child binding, then performs the saved TrackMap cold-start/repeated-inspection/A-to-B/same-source matrix on its integrated desktop build. UI lane can start now.
