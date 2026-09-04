# Media MCP request validation

All eight media commands validate their arguments before looking up the active
controller or starting native work. Invalid requests return a path-specific
error and do not create a capture job.

## General rules

- Unknown top-level or nested properties are rejected.
- Required fields, primitive types, enum values, ranges, array sizes, and string
  patterns are checked without coercion. Numeric and boolean strings are not
  converted automatically.
- `rav_export_media` and `rav_record_start` require `format`.
- Omitted arguments are accepted as `{}` only for tools whose schema permits an
  empty request. `null` is not an empty request.
- Encoding values pass through unchanged after validation. Validation does not
  rescale dimensions, alter FPS, change formats, repair GIF options, or add a
  duration limit.

The canonical schemas are in
[`mcp-server/tools/media-tools.json`](../mcp-server/tools/media-tools.json).

## Recording interactions

Omitted or `null` `duration_seconds` selects manual stop. A supplied duration
must be finite and positive, and every scheduled interaction must occur before
that duration. Dot-separated ViewModel paths normalize to slash-separated paths,
signed color values normalize to unsigned 32-bit values, and scheduled image
byte arrays are copied before preparation.

Scheduled images share a 32 MiB encoded-data budget and a 256 MiB estimated
decoded RGBA budget. Dimensions must be known, positive, integral, and safe
before decoding starts. See
[`MEDIA_INTERACTION_SCHEDULE.md`](MEDIA_INTERACTION_SCHEDULE.md) for supported
interaction types and timing behavior.

## Format-specific checks

- GIF fields are valid only with `format: "gif"`.
- `at_seconds` is valid only for still-image export.
- Segment fields are valid only for animated timeline export.
- Top-level `quality` and `gif.quality` may both be present only when their
  values match. Either field can be supplied by itself.
- PNG and APNG ignore quality because they are lossless.
- Codec support, alpha support, even video dimensions, selected-timeline bounds,
  and optional encoder features are checked by the media service after schema
  validation. Query `rav_media_capabilities` before choosing settings.

The desktop UI applies the same service-level rules after resolving its controls.
MCP clients should keep the original request and returned job ID, then poll
`rav_media_status` until the job is completed, failed, or cancelled.
