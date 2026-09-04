# Scheduled recording interactions

`rav_record_start` accepts `interactions`. Each operation has `at_seconds` and
`type: "vm-set" | "vm-trigger" | "pointer"`. Scheduled interactions run in the
desktop recording path.

Recording owns Rive advancement. Frame zero applies time-zero operations and
renders with zero delta; each following frame advances by exactly `1 / fps`.
An operation runs at the first frame boundary at or after its requested time,
ordered by time and then original input order for ties. Delayed wake-ups render
intervening frames individually, yielding between bounded batches. Encoder
capacity is checked before advancing or applying scheduled operations. Lateness
in interaction receipts is relative to simulation time; wall-clock scheduling
lag is separately reported by `resolved_settings.capture_clock.max_lag_ms`.

Omitted or explicit-null `duration_seconds` means manual stop. A supplied duration
must be finite and positive. Scheduled times must be strictly before it. There
is no product duration ceiling. Disk space and actual device throughput remain
physical constraints; finite queues avoid memory growing with recording length.
Hardware capture selection is internal, with no `capture_mode` MCP option.

```json
{
  "format": "apng",
  "duration_seconds": null,
  "interactions": [
    {"at_seconds":0,"type":"vm-set","descriptor":{"path":"enabled","kind":"boolean"},"value":true},
    {"at_seconds":0.5,"type":"vm-set","descriptor":{"path":"rows/0/label","kind":"string"},"value":"Leader"},
    {"at_seconds":1,"type":"vm-set","descriptor":{"source":"global-view-model","globalViewModelName":"Shared","path":"theme/tint","kind":"color"},"value":4294901760},
    {"at_seconds":1.5,"type":"vm-trigger","descriptor":{"path":"controls/go"}},
    {"at_seconds":2,"type":"pointer","event":"down","x":0.4,"y":0.6,"buttons":1},
    {"at_seconds":2.2,"type":"pointer","event":"up","x":0.4,"y":0.6,"buttons":0}
  ]
}
```

The paths above are examples; obtain real paths and kinds from the selected
fixture's VM tree. `descriptor.source` defaults to `view-model`. Nested and
zero-based list paths use the existing accessor route, including global lists;
dot-only paths normalize to slashes. List targets resolve when due, allowing an
earlier interaction to create a later target. An absent or wrong-kind target
fails the schedule; no later operation runs. Scheduling does not add list insert,
remove/reorder, VM instance switching, SM input operations, keyboard, wheel or
multi-touch APIs.

Scalar kinds: `number` (finite), `boolean`, `string`, `enum` (string choice),
`color` (signed/unsigned 32-bit integer; signed values normalize to unsigned).
Enum availability is checked against the live accessor when it provides choices.
`vm-trigger` implies trigger kind. Pointer operations use `event` because `type`
is already the operation discriminator; x/y are inclusive 0–1 and id is 0.

Images use `type:"vm-set"`, `descriptor.kind:"image"` and either `bytes:[...]`
(1–16 MiB, integer 0–255) or `value:null` to clear. Optional `label` has at most
255 characters. Bytes and value are mutually exclusive. Existing raster header,
dimension and runtime decode validation runs before the clock starts. Preparation
retains decoded images until their scheduled frame is drawn, or cleanup cancels
them. The complete schedule is inspected before the first decode: total encoded bytes
must not exceed 32 MiB, and total estimated RGBA bytes (width × height × 4) must
not exceed 256 MiB. Unknown, nonpositive, fractional or unsafe dimensions fail
preflight. Equality at either budget is allowed. These are image-preparation
budgets, not duration limits or a guarantee of measured process/GPU memory.

## Runtime and cleanup contract

The host validates the entire input before creating a native job. The renderer
validates and predecodes images before starting time, retains them until their
scheduled frame is drawn, then journals the new image state and releases its
preparation reference. `schedule.run(frameIndex / fps, frameIndex)` executes
synchronously before advance/draw; `afterFrame()` runs after draw/flush. Image
assignment deliberately avoids a future-frame presentation wait in this path.

Source/player identity is checked throughout. Stop, cancel, failure and source
replacement dispose pending resources and prevent further scheduled operations.
The final status snapshot is taken before disposal. Scheduled values are applied
to the actual live VM; they remain until another edit or reset changes them.

`rav_media_status` exposes `interaction_schedule` during capture and completion:
`scheduled`, `applied`, `pending`, `cancelled`, `error`, and receipts containing
`index`, `type`, `scheduled_seconds`, `applied_seconds`, `lateness_seconds`, and
`frame_index`. It does not echo values or image bytes. Inspect those receipts,
the capture clock and the decoded artifact; none alone proves visual correctness.

Manual mouse and VM edits still operate on the live state. Scheduled operations
provide exact frame-boundary timing; sustained capture lag can affect the
relationship between unscheduled live input and wall time and must be reported,
not hidden behind a constant-FPS output label.

## Validation rules

Recording format enum excludes PNG/JPG/WebP; those remain still exports.
Pointer schemas publish 0–1 coordinates. GIF repeat publishes its i16 positive
maximum of 32767. GIF quality compatibility and conflict rules are documented in
`MEDIA_EXPORT.md`. Format-specific resource limits come from capabilities.

The media-handler validator enforces the advertised constraints for all eight
media tools before controller lookup, without coercion or dropping unknown
fields. Both Node and native MCP paths reach this handler boundary.
Source-dependent and cross-field encoding restrictions remain the controller
and native service responsibility. See `MEDIA_REQUEST_VALIDATION.md` for the
complete raw-argument rules.
