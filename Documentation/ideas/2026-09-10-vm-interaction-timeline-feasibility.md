# VM interaction timeline — feasibility study and pre-plan

Captured: 2026-09-10
Companion to: [2026-09-10-vm-interaction-timeline.md](2026-09-10-vm-interaction-timeline.md)
Baseline reviewed: unreleased 2.5.6 working tree (single-owner desktop playback,
parse-once file inspection, recording-only native frame clock).

## 1. Verdict

Feasible, additive, and mostly host-UI work. Everything the timeline needs at
execution time already exists in the recording path:

| Need | Already in the tree | Gap |
| --- | --- | --- |
| Deterministic frame-boundary application of VM writes | `RavMediaInteractions.create().run(seconds, frameIndex)` runs synchronously before advance; recording owns advancement at exactly `1/fps` | None |
| Typed VM writes by path (root, nested, global, list items) | `vm-set` / `vm-trigger` descriptors, `resolveControlAccessor`, prepared-accessor fallback | Add an op that writes **every frame** from a keyed curve |
| Pointer down/move/up/exit | `pointer` ops | None (drag = down + moves + up) |
| Receipts, status, cancel, source-change safety | `interaction_schedule` receipts, `isCurrent()` checks | Track-level receipts |
| Source fps | Inspection metadata carries per-animation `fps` | Pick default from selected artboard's animations |
| Same code in the standalone demo | `demo_bundle.rs` concatenates the demo-template JS the child runs | Ship the compiled timeline in the bundle |
| Stable per-file identity for sidecars | `render-source-identity` (hash-based) | Sidecar lookup by path first, identity second |

The one genuinely new runtime piece is small: a **track evaluator** (piecewise
keyframes, cubic-bezier easing, hold, per-channel color, Type-On string) that
runs inside the child on either the recording clock or the live RAF. Roughly
150–250 lines of shared JS plus tests.

The expensive part is the DCC UI (track list, key lane, playhead, in/out,
curve editor) in the host WebView. That is where the schedule should be
front-loaded and phased.

## 2. What the current contract gives us, exactly

From `MEDIA_INTERACTION_SCHEDULE.md` and the code:

- `schedule.run(frameIndex / fps, frameIndex)` fires once per recorded frame
  **before** advance/draw (`recording-clock.js:30`). Frame 0 renders with zero
  delta. This is the ideal hook: a track evaluated at `frameIndex / fps` and
  written before the advance is guaranteed to be visible in that frame.
- An op runs at the first frame boundary at or after `at_seconds`, ordered by
  time then input order. Receipts carry `lateness_seconds` relative to
  simulation time, so lateness is always 0 for frame-aligned keys.
- Accessors resolve when due (so a list row created earlier can be targeted
  later) with a prepare-time fallback (`preparedAccessors`).
- `duration_seconds` is exclusive-end; all ops must be `< duration`.
- The validator is duplicated in four places on purpose, with a parity test:
  `mcp-server/tools/media-tools.json` (MCP schema, embedded into the Rust MCP
  binary), `src/app/platform/media/request-validation.js` (raw-arg gate),
  `src/app/platform/media/interaction-validation.js` (host copy of the child
  validator), `src-tauri/src/demo-template/js/media/interaction-schedule.js`
  (child + source of truth). Extending the contract means touching all four
  and updating the parity test.
- Rust does not inspect interactions (`media_export/mod.rs` has no schedule
  knowledge). No Rust changes for the contract extension.
- Recording requires state-machine playback (`ui/media/model.js:17`). The
  timeline inherits that constraint, which is correct: VMs bind through SMs.

## 3. Proposed contract extension: `vm-track`

Keep `vm-set`, `vm-trigger`, `pointer` unchanged. Add one op type that carries
a whole keyed track, so the timeline document compiles 1:1 and receipts stay
per track instead of per frame:

```json
{
  "type": "vm-track",
  "descriptor": { "path": "STAGE_VM/CTRL/Orb Scale", "kind": "number" },
  "keys": [
    { "at_seconds": 0.0, "value": 0,   "interpolation": "bezier", "out": [0.42, 0], "in": [0.58, 1] },
    { "at_seconds": 1.5, "value": 100, "interpolation": "hold" },
    { "at_seconds": 2.0, "value": 40 }
  ]
}
```

Semantics:

- Keys sorted by time; times must be `>= 0` and `< duration_seconds` when a
  duration is supplied. Duplicate times are an error (the UI prevents them).
- Before the first key: no write (live state stands). This keeps the "values
  remain until another edit" rule from the existing contract.
- Between keys: value from the **outgoing** key's interpolation. `hold` = keep
  the previous key's value; `linear`; `bezier` with `out`/`in` handles
  (`x` clamped to `[0,1]`, same shape as CSS/Rive cubic interpolators).
- At and after the last key: write the last value once, then stop writing.
- Writes happen only when the evaluated value differs from the last written
  value for that track (cheap dedupe, avoids dirtying idle holds every frame).
- Kind rules:
  - `number`: full interpolation.
  - `color`: two sub-curves in one track: `rgb` (per-channel sRGB, straight
    alpha) and `alpha` (0–1, written as the A byte). A key may set either or
    both. Composite into one ARGB uint32 write per frame.
  - `boolean`, `enum`: `hold` only; validator rejects other interpolations.
  - `string`: `hold`, plus `type-on` between two keys: `value` of the
    outgoing key is the final text, the segment reveals `round(n * eased t)`
    leading characters (grapheme-aware via `Intl.Segmenter` when available,
    code points otherwise). Reverse is the mirror (type-off) — cheap to offer.
  - `trigger`: not a track. Trigger keys compile to `vm-trigger` ops.
  - `image`: not in phase 1. Image keys would compile to existing image
    `vm-set` ops (hold semantics come for free).
- Pointer keys compile to existing `pointer` ops. A drag key = `down` at
  its time, `move` per frame along an eased path, `up` at its end. This is
  how hover/click/drag get authored: a pointer track with `hover`,
  `click`, `drag` key types that the compiler expands.

Receipts: one per track with `first_frame_index`, `last_frame_index`,
`writes` count, plus existing per-op receipts for triggers/pointer. Status
does not echo values, same as today.

Why not expand tracks to per-frame `vm-set` ops on the host? It works with
zero child changes, but a 60 s × 60 fps × 20-track timeline is 72 000 ops:
72 000 receipts in `rav_media_status`, 72 000 accessor lookups in preflight,
and a multi-megabyte command payload across the Tauri event bridge. `vm-track`
keeps payload and receipts proportional to authored content.

## 4. Timing model

- **Time base**: the timeline's `fps` defaults to the selected artboard's
  first animation `fps` from inspection metadata (Rive default 60) and can be
  overridden. Keys are stored in seconds; the UI snaps to `1/fps`. Recording
  uses the timeline fps as the capture fps so key frames align exactly
  (`lateness_seconds` = 0). If the user records at a different fps, keys
  still apply at the first boundary at or after their time — same rule as
  today — and the UI warns.
- **In/out markers**: recording range `[in, out)`. The compiler subtracts
  `in` from every time, sets `duration_seconds = out - in`, and drops ops
  before `in`. For tracks, the value at `in` is evaluated and emitted as a
  key at `0` so the recording starts in the authored state. Triggers before
  `in` are dropped with a warning in the compile report (they are events;
  replaying them pre-roll would change SM state unpredictably).
- **Starting VM state**: whatever is live, plus tracks evaluated at `in`.
  Optional "reset artboard before record" toggle uses the existing reset
  path (which preserves control values per the 2.5.5 contract, so tracks
  still win).
- **Determinism**: unchanged — recording owns advancement. Two recordings of
  the same timeline produce identical receipts; the decoded frames differ
  only if the SM itself is non-deterministic (random, wall-clock scripts).

## 5. Preview and scrubbing — the real design problem

The idea note is right that a keyed VM timeline is "a pre-programmed state
machine" and that scrubbing is not free. Three distinct behaviours:

1. **Play preview** (forward, real time): a child-side runner hooks the same
   place the recording pump does (`_boundDraw` wrapper in
   `frame-clock.js`), advances a timeline clock by the RAF delta, evaluates
   tracks, writes values, fires trigger/pointer ops as their time passes.
   Uses live playback, no encoder. Cheap and exact enough for authoring.
2. **VM-only scrub** (both directions, instant): evaluate every value track
   at `t` and write. Numbers, colors, booleans, enums, strings all go
   backwards correctly because they are pure functions of `t`. The state
   machine is **not** rewound; it keeps advancing (or stays paused) from
   wherever it is. Triggers and pointer ops do not fire. This is the default
   scrub and matches how most DCC scrubbing of "driven parameters" feels.
3. **Re-simulate scrub** (exact, slow): reset artboard, then step
   `t * fps` explicit frames applying the compiled schedule — literally the
   recording path without an encoder (`renderSurfaceAdvanceFrame` exists
   for this). Cost is O(t · fps) per scrub; at 60 fps a 10 s seek is 600
   explicit frames, workable with a debounce but not interactive dragging.
   Offer as an explicit "Simulate to playhead" action, not as the drag
   behaviour.

Recommendation: ship 1 and 2 in the first release; 3 as an action once the
UI exists. This resolves "I am not sure how it can be scrubbed": VM values
scrub; SM state is either live (mode 2) or re-simulated on demand (mode 3).

Transport: the timeline panel gets its own play/pause/stop and loops the
in/out range; the existing header play/pause continues to control the
Rive instance. Timeline play forces the instance to play (same as trigger
ops do today).

## 6. Host ↔ child protocol additions

All additive commands through the existing render-surface protocol
(`protocol.requestCommand` / `handleRenderSurfaceCommand`):

- `timeline-load { tracks, ops, fps, in, out }` — child validates with the
  shared validator (same code path as recording preflight) and resolves
  accessors; replies with unresolved paths so the UI can mark dead tracks.
- `timeline-seek { seconds }` — VM-only scrub.
- `timeline-play { loop }`, `timeline-pause`, `timeline-stop`.
- `timeline-unload`.
- Recording: `media-record-start` accepts the compiled `interactions` as it
  does today; the host compiles from the loaded document. No new recording
  command.

Child state is per session, so a source swap, reset, or surface retirement
drops the loaded timeline like it drops recordings today (`disposeRenderSurface`
in `render-surface-lifecycle.js` is the hook).

Live feedback into the host (canonical deltas on advance) already happens,
so the Properties drawer reflects preview writes without new plumbing. The
vm-change-channel investigation is **not** a dependency: the timeline is
write-only.

## 7. Persistence and file formats

- **Document** (`rav-timeline`, JSON, versioned):
  `{ version, source: { name, identity }, fps, in, out, tracks[], markers[] }`.
  Tracks reference descriptors exactly as the schedule does, so the compile
  step is a projection, not a translation.
- **Sidecar** first: `<file>.riv` + `<file>.rav-timeline.json` next to it.
  On open, RAV looks for the sidecar by path and verifies `source.identity`
  against the loaded bytes (warn, don't refuse, on mismatch — files get
  re-exported). Requires a read/write pair of Tauri commands scoped to the
  opened file's directory.
- **`.rav` bundle** (zip of `.riv` + document, optionally embedded images)
  later: needs a zip crate in `src-tauri` (none today), a new UTI and
  extension registration alongside the existing `riv` handling in
  `launch_services.rs` / `tauri.conf.json`, and an "open .rav" path that
  extracts to a session temp dir. Worth doing once sharing is a real
  workflow; not needed for authoring.
- **MCP**: `rav_timeline_get` / `rav_timeline_set` (document in, compile
  report out) so agents can author the same thing the UI does, and
  `rav_record_start { timeline: true }` to record the loaded document.
  Agents that prefer raw ops can still send `vm-track` directly.

## 8. Standalone export

The demo bundle already embeds the same media/schedule JS the child runs, so
the evaluator ships automatically. Export options:

- Embed the compiled `interactions` in the bundle config and add a
  "Play timeline" control to the demo chrome (the runner from §5 mode 1,
  driven by the demo's own RAF). No recording in the demo.
- Emit a companion `interactions.json` for developers using the generated
  web snippet; the snippet generator gains an optional block that loads
  the evaluator and calls it from `onAdvance`.

The first option is the useful one for "show a stakeholder the authored
sequence". The second is the developer hand-off.

## 9. UI pre-plan

Host WebView, vanilla JS + CSS, following the existing panel conventions.

- **Placement**: a collapsible panel docked under the canvas inside
  `#center-panel`, below the runtime strip. The canvas container shrinks;
  the native child follows through the existing bounds sync, so no
  overlay/blocking-UI concerns. Height persisted like the side panels.
- **Regions**: track header column (name, kind pill, value readout, mute,
  remove) · key lane (2D canvas: frames ruler, in/out markers, playhead,
  key diamonds, hold/bezier segment glyphs) · transport row (play/pause/
  stop, loop, fps, in/out fields, "Simulate to playhead", Record) ·
  curve editor (2D canvas, toggled per track: value vs time, bezier handles,
  fit/zoom, numeric handle fields).
- **Adding tracks**: a "+" in the track header opens the existing VM tree
  (reuse the Properties drawer's tree renderer and descriptors) and every
  writable kind is offered; triggers and pointer create event tracks.
  Keying a value from the Properties drawer ("Add key at playhead") is the
  fast path and reuses the drawer's current value.
- **Colors**: a color track shows two lanes (RGB, Alpha) inside one row;
  the RGB key editor is the existing color input, alpha a 0–100 field.
- **Strings**: hold keys plus a Type-On segment toggle between two keys.
- **Pointer**: one track, key types hover/click/drag with x/y fields
  (0–1, matching the pointer contract) and a drag path (start/end).

The curve editor is the largest single piece. Key lane + transport without
the curve editor (linear/hold/preset easings from a dropdown) is a
shippable intermediate.

## 10. Phasing and sizing

Relative sizes (S < M < L) against the 2.5.5 media work as a yardstick.

| Phase | Deliverable | Size | Value unlocked |
| --- | --- | --- | --- |
| 0 | `vm-track` contract: evaluator module (shared child/host), four validators + parity test, receipts, `MEDIA_INTERACTION_SCHEDULE.md`, MCP schema | S–M | Agents can author interpolated recordings today with no UI |
| 1 | Timeline document + compiler + compile report; sidecar read/write; `rav_timeline_get/set`; `rav_record_start { timeline }` | M | Persisted, reproducible authored sessions |
| 2 | Child runner: `timeline-load/seek/play/pause/stop`; VM-only scrub; Properties drawer reflects preview | M | Preview without recording |
| 3 | Panel UI: tracks, key lane, playhead, in/out, transport, add-track from VM tree, hold/linear/preset easing | L | The feature as most users will see it |
| 4 | Curve editor with bezier handles | M–L | Authored easing |
| 5 | Pointer track (hover/click/drag), Type-On strings, "Simulate to playhead" | M | Interaction authoring, text |
| 6 | Standalone export "Play timeline", `.rav` bundle, image keys, text animator | M–L each | Sharing and polish |

Phases 0–2 are all headless and fully unit-testable with the existing
vitest harness (the schedule already has a pure `create()` API that takes a
fake clock). Phase 0 is the smallest next step and is more useful than a UI
sketch: it lets MCP agents exercise the exact execution semantics the UI
will later target, so the semantics get validated on real files before any
pixels are drawn.

## 11. Risks and mitigations

- **Binding conflicts**: a track writing a property that the SM or a script
  also drives is last-writer-wins per frame. The track writes before
  advance, so the SM wins within the frame if it also writes. Document it;
  the UI can flag properties that the inspection schema shows as bound targets
  (inspection exposes bindings) in a later phase.
- **Per-frame write cost**: N tracks → at most N accessor writes per frame,
  deduped. Negligible next to encoding. Prepared accessors are cached at
  load, with the existing re-resolve fallback for nested wrapper churn.
- **List targets**: paths through lists (`rows/0/label`) resolve when due;
  if the list shrinks mid-timeline the track fails the schedule, same as a
  wrong path fails today. Compile report warns when a track path crosses a
  list whose length the inspection schema reports as smaller than the index.
- **Frame alignment at non-timeline fps**: handled by the existing
  "first boundary at or after" rule; the UI warns when record fps ≠
  timeline fps.
- **Scrub expectations**: users will expect SM state to follow the
  playhead. Label the default as VM scrub and put "Simulate to playhead"
  one click away (§5).
- **Host bundle growth**: none for the runtime; the UI adds CSS/JS in the
  host only. The child gains the evaluator (small).
- **Architecture budgets**: `demo-template/js/core` and `/vm` are at 10
  direct files (the check warns). New child code goes in
  `demo-template/js/media/timeline/` or `js/timeline/` from the start.

## 12. Open decisions (recommendations inline)

1. Color space: sRGB per channel, straight alpha (matches Rive's own
   color keyframes). Offer OKLCH later as a per-segment option.
2. Trigger on scrub: never. Fire only in forward play/record.
3. Value before first key: leave live state untouched (recommended) vs.
   hold first key's value backwards (AE behaviour). AE-style is one flag if
   users ask for it.
4. Key at `in` for tracks starting before `in`: emit evaluated value at 0
   (recommended) so recordings start in the authored state.
5. Type-On unit: graphemes when `Intl.Segmenter` exists, else code points.
   Word-level and AE-style animators deferred.
6. Sidecar vs `.rav`: sidecar first; `.rav` when sharing becomes a use case.

## 13. Release placement

Decision (2026-09-11): the pending working tree ships as **2.5.6**; the VM
authoring timeline is **2.6.0**.

- **2.5.6** ships the current working tree as is. It carries one large
  architectural change (single Rive owner, parse-once file inspection,
  recording-only native clock) and one MCP removal
  (`rav_get_sm_inputs` / `rav_set_sm_input`). The patch label under-signals
  that scope, so the changelog entry carries an explicit Removed section and
  a Changed line for background playback. Adding the timeline to it would
  couple two unrelated risk surfaces in one release.
- **2.6.0** for phases 0–3 (contract, document, runner, base UI). Everything
  is additive: no existing MCP tool, schedule field, or file format changes
  meaning. Phases 4–5 can land in 2.6.x or 2.7.0.
- **3.0** is not justified by this feature on semver grounds. If a major is
  wanted, the honest trigger was the MCP tool removal in 2.5.6, or a future
  `.rav` format that changes what "opening a file" means. A marketing major
  ("RAV becomes an authoring tool") is a separate call and would argue for
  waiting until phases 0–4 are all in.
