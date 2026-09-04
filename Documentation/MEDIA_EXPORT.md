# Media export and recording

Media export requires desktop RAV and its native encoder service; browser RAV
and exported standalone HTML do not provide this service. Captures contain the
Rive canvas, optionally a cursor, but no RAV controls or audio.

## Availability and packaging

Check `rav_media_capabilities` before choosing a format. Its per-format
`available` and `reason` fields reflect encoder discovery and small encode/decode
probes, not acceptance of your animation. WebM probing also checks decoded alpha.

The desktop About window, available from Settings and the native Help menu,
shows the active Rive Web runtime beside the exact FFmpeg, ffprobe and optional
gifski versions returned by this capability check. A missing or rejected tool is
shown as unavailable.

Desktop packages bundle pinned Jellyfin FFmpeg and ffprobe 7.1.4-3 resources.
Each platform manifest records binary filenames, sizes, SHA-256 hashes,
provenance, GPL-3.0-or-later notices, and the exact corresponding-source URL and
hash. The release workflow signs and verifies the binaries before packaging,
then verifies the final bundle again after notarization or Windows packaging.
Production never falls back to an arbitrary FFmpeg or ffprobe on `PATH`.

gifski is not bundled in the production distribution. GIF remains available
through the bundled FFmpeg palette adapter. If an optional DEV gifski executable
is configured, its additional controls are capability-gated; explicitly asking
for gifski when it is unavailable fails before output is published.

## Choose a capture mode

Open **Export**, then select:

| Mode | Current behavior |
| --- | --- |
| **Timeline** | Select a linear animation with known duration. Export **Full timeline** or a **Segment**, using seconds or zero-based native timeline frames. A separate player advances explicitly, including preroll to the segment start. |
| **Record interactions** | Select a state machine. Capture its current live state, pointer interactions and ViewModel edits without implicitly resetting it. Stop manually or after a duration. Starting closes the panel so the canvas and controls remain usable. |
| **Still image** | Capture the current visible frame in either playback mode, or choose a timeline time/frame. PNG, JPG and WebP are still formats. |

The chooser uses three compact mode cards plus a separate Web & code row. Media
settings keep the capture-specific controls and output controls in two columns
when space permits, with the format selector available throughout. The resolved
output and primary action remain in the footer. Completed-job diagnostics are
collapsed under **Technical details** until opened.

Export and snippet/HTML export use the same modal native-overlay controller as
Settings, MCP Setup and About. While any of these windows is open, the main RAV
interface is inert. Clicking outside dismisses the overlay but cannot also
expand a drawer, press a toolbar control or change a property underneath it.

Full timeline means authored duration, not an implicit work-area selection.
Segments use **[start, end)**: the start is included and the end is excluded.
`start_frame`/`end_frame` use the source timeline FPS, not output FPS; frame fields
take precedence over corresponding second fields. Prefer one unit per request.
At 30 source FPS, frames 30–60 select seconds 1–2, excluding frame 60.
Output count is `ceil((end_seconds - start_seconds) * output_fps)`; samples begin
at the start and remain before the end. A state machine has no inferred whole
duration: use recording instead.

Use the toolbar **STOP** or **Cmd/Ctrl+Shift+R** to stop recording and begin
encoding. When idle, the shortcut opens recording setup or starts the configured
recording draft. It is ignored in typing fields/editors, during composition and
for repeated key events. **Include cursor** overlays the tracked canvas pointer;
it does not record the operating system desktop. Changing source or playback
selection during capture stops the job with an error.

The preview stays centered while capture temporarily uses the output aspect
ratio, then returns to its normal sizing. Its visible canvas keeps at least the
backing resolution required by its displayed size and the current device pixel
ratio. Capture composition downsamples that surface separately to the requested
output dimensions, so a small export cannot turn the larger live preview into a
stretched, pixelated image. **EXPORT** also reopens the latest result; there is no
separate Media result button. The toolbar shows **STOP** only while recording.
Capture, encoding, verification and saving progress live in the bottom status bar,
with a lime RAV progress indicator. Normal playback status returns when the job
completes, fails or is cancelled.

Recording does not fill missing video samples by repeating earlier pictures.
Every accepted frame has a consecutive index and a fixed simulation step. If the
device temporarily falls behind, RAV renders the pending frames individually;
status exposes the lag. Sustained overload can still affect the responsiveness
of unscheduled live interactions. Explicit warnings remain for disk-space stops,
recovery and unmet GIF size targets; errors remain failures. Older receipts with
synthetic frame holds still display one amber summary instead of duplicate alerts.

## Formats and output controls

All entries below remain conditional on capabilities.

| Format ID | File | Mode / transparency |
| --- | --- | --- |
| `h264` | `.mp4` | Animated, opaque background/matte |
| `h265` | `.mp4` | Animated, opaque background/matte |
| `webm` | `.webm` | Animated VP9, alpha when verified available |
| `apng` | `.apng` or `.png` | Animated, full alpha |
| `gif` | `.gif` | Animated, binary transparency only; timing is quantized |
| `png` | `.png` | Lossless still, full alpha |
| `jpg` | `.jpg` or `.jpeg` | Lossy still, opaque matte |
| `webp` | `.webp` | Still with alpha; quality 100 selects lossless encoding |

- **Dimensions:** default to source artboard dimensions. A single explicit width
  or height preserves aspect ratio; setting both supplies exact dimensions.
  `scale` accepts values greater than zero through 8. The UI offers source scales
  and an aspect lock. Maximum edge is 4096, maximum area 4,194,304 pixels; H.264,
  H.265 and WebM dimensions must be even.
  The UI rounds its initial video dimensions and dimensions on a video-format
  change to even values; explicitly entered odd values still fail validation.
- **FPS:** defaults to native timeline FPS, or 60 when unavailable. Animated
  output supports 1–60 FPS, with GIF capped at 50. MCP also accepts a rational
  `{ "numerator": 30000, "denominator": 1001 }`. Presets may reduce FPS; inspect
  resolved settings. Use `fps: 1` for MCP still capture, which needs only one frame.
- **Quality:** integer 1–100, default 80 except Small GIF (60). Its effect depends
  on the encoder; it is not a file-size guarantee. PNG/APNG are lossless: the UI
  hides/disables quality and omits it; MCP accepts it for compatibility with no
  encoding effect. For GIF, either `quality` or `gif.quality` alone overrides the
  preset default; equal duplicates are accepted and conflicting values rejected.
- **Background:** `alpha` defaults to false and `background` to `#000000`.
  Opaque formats reject alpha; GIF cannot preserve smooth translucent edges.
- **Destination:** the desktop Export panel uses **Choose file…** to open the
  native Save dialog before capture. Choose both the folder and filename; RAV
  shows the resolved path in the panel and submits directly to it. Cancelling
  returns to the unchanged settings. Changing the format clears the chosen path
  so the next dialog applies the correct extension and file filter. MCP callers
  may supply an absolute `output_path` with the matching extension, or omit it to
  open the same native dialog. UI exports do not overwrite. MCP defaults to
  `overwrite: false`; explicit `true` permits atomic replacement after output
  validation. Cancellation preserves an existing destination.

## GIF presets and target size

| `gif_preset` | Resolution / FPS / initial quality |
| --- | --- |
| `source` | Requested source sizing/rate within limits; default quality 80 |
| `balanced` (default) | Longest edge at most 960; at most 20 FPS; quality 80 |
| `small` | Longest edge at most 480; at most 12 FPS; quality 60 |
| `custom` | Explicit output settings within limits |
| `target-size` | Requires `gif.max_bytes`; uses bounded search |

Small and Balanced never upscale. Explicit quality through either GIF quality field overrides preset
quality without changing preset dimensions or FPS. `gif.encoder` is `auto`, `gifski` or `ffmpeg`; use capability flags to
check availability and optional `motion_quality`/`lossy_quality` support.
Unsupported encoder controls fail rather than being silently ignored.
`gif.repeat` is 0 for forever, -1 for no repeat, or a positive repeat count
(maximum 32767); repeating does not guarantee a seamless loop.

Target size is a best effort, with **at most five encoding attempts** from a
retained lossless master. The UI accepts MiB; MCP uses bytes. Set
`gif.size_policy` explicitly: `quality_only` preserves dimensions/FPS;
`quality_fps_scale` also permits reducing them without shortening duration.
If no attempt meets the target, the smallest result is published with
`target_met: false`. Inspect actual bytes, resolved settings and warnings; a
completed job can still miss its size target.

## MCP jobs and examples

These tools use the same host service as the UI. Examples are request examples,
not artifact-validation receipts. Use your own paths and returned job IDs.

| Tool | Purpose |
| --- | --- |
| `rav_media_capabilities` | Available formats/encoders, alpha, GIF controls, limits and distribution status |
| `rav_export_media` | Asynchronous whole/segment timeline export, or still capture inferred from format; omit `at_seconds` for the current frame |
| `rav_record_start` | Start live state-machine recording; optional `duration_seconds`, otherwise manually stopped without a duration ceiling |
| `rav_record_stop` | Seal capture and promptly return its job; poll while remaining frames drain and encoding/verification finish |
| `rav_media_status` | Poll by `job_id`, or omit it for current/most recent; returns progress, resolved settings, warnings, errors and output details |
| `rav_media_cancel` | Cancel capture/encoding and clean temporary data; does not undo completed publication |
| `rav_step_frames` | When not recording, advance 1–600 frames at 1–240 FPS, draw, then pause; defaults to 1 frame at 60 FPS, including while hidden |
| `rav_pointer` | Send mouse `down`, `move`, `up` or `exit` to the live canvas; normalized x/y (0–1 inside), optional `buttons`; `id` is always 0. Multi-touch injection is not supported. |

Run each call separately through your MCP client:

```text
rav_media_capabilities({})

// Select a timeline first. Whole timeline:
rav_export_media({"format":"h264","width":1280,"height":720,"fps":30})
// Or a segment, after the previous job finishes:
rav_export_media({"format":"gif","start_frame":30,"end_frame":60,
  "gif_preset":"target-size","quality":80,
  "gif":{"max_bytes":2097152,"size_policy":"quality_fps_scale"}})

// Still from current canvas, or add at_seconds on a timeline:
rav_export_media({"format":"png","fps":1,"alpha":true})

// Select a state machine first; interact while capturing:
rav_record_start({"format":"webm","width":1280,"height":720,
  "fps":30,"cursor":true,"duration_seconds":10})
rav_pointer({"type":"down","x":0.5,"y":0.5,"buttons":1})
rav_pointer({"type":"up","x":0.5,"y":0.5,"buttons":0})
// Existing VM tools/controls also affect the live recording.
rav_record_stop({}) // optional early stop, before the timed stop

rav_media_status({"job_id":"<returned-job-id>"})
rav_media_cancel({"job_id":"<returned-job-id>"}) // only if abandoning the job
rav_step_frames({"frames":30,"fps":30}) // separate playback operation
```

A job progresses through host `preparing`, then `capturing`, `encoding`, and
`completed`, `failed` or `cancelled`. A missing retained job returns `idle`.
Poll until terminal: start/stop responses do not mean an artifact is ready.
Final `resolved_settings` retains the capture mode, source segment and
`source_timeline_fps` alongside the encoder's actual dimensions, FPS and decode
verification. Native `source_fps` refers to the incoming captured-frame rate.
Cancellation during encoding can remain `encoding` until the subprocess is
stopped/reaped and cleanup finishes. Keep the host job ID; the service maps it
to the native job. Host history retains 20 jobs; native receipts retain 32 and
are not a permanent export history.

Only **one active job**, including finalization, is admitted. There is no product
recording-duration, frame-count, temporary-file-size, output-size or total-job-time
ceiling. Omitted or null `duration_seconds` means manual stop. Free space on the
destination volume determines how long capture can continue; capture reserves
room for a source-sized final file plus 128 MiB, then can use that reservation
while finishing down to an 8 MiB emergency floor. This is a free-space check,
not an OS reservation against other apps. On low space, a nonempty recording
seals its accepted frames and finishes that portion with `stop_reason: disk_space`.
Storage write, publication or idle-watchdog failure retains acknowledged capture data for
manual recovery rather than publishing an unverified file. A recovery descriptor
records accepted counts and whether an unacknowledged tail was repaired. Explicit
cancellation still cleans up immediately, including while an encoder is stalled.
Renderer/transport failures also retain acknowledged data. Missing bytes are never
zero-filled and marked repaired; the descriptor warns when manual repair is still
needed. Recovery does not promise every hardware failure is recoverable.

Memory and format safeguards include four megapixels, a 4096-pixel edge, 1–60 FPS
(1–50 for GIF), bounded upload/encoder queues, 20 MiB packets, one native write,
768 MiB sampled encoder memory and two encoding threads. Watchdogs detect stalled
capture/encoder work, not elapsed recording length. Counts have a technical u32
storage ceiling. Capability limits are authoritative; none of these checks can
make a slow disk or overloaded GPU sustain a requested frame rate.

Opaque H.264, HEVC and VP9 recording probe WebCodecs in the actual render WebView.
When supported, RAV requests hardware acceleration and encodes while recording.
Small binary batches travel directly to native disk IO, bypassing the host UI,
base64 and per-frame host acknowledgements. HEVC/AVC packet boundaries and a
constant frame clock are preserved. Stopping only packages the encoded stream
into MP4/WebM, then fully decodes it once to verify it before publication. The
receipt says `capture_transport: webcodecs-binary` and `stream_copy: true`;
`prefer-hardware` is a request, not proof of hardware use on every system.

Alpha, APNG, GIF and unsupported video configurations retain the lossless PNG
path. Three bounded worker slots overlap compression with direct native binary
writes. Frame indexes are journaled on disk; memory does not grow per elapsed
recording frame. These formats still require encoding after stop. Long automatic
GIF jobs use the FFmpeg adapter when gifski's command-line input limit would be
exceeded; explicitly requested unsupported gifski controls fail clearly.

Recording owns the frame clock: frame zero draws with zero delta, then every
frame advances by exactly `1 / fps`. Native wake-ups keep it running when browser
RAF is suppressed. Delayed wake-ups render intervening frames individually in
bounded batches. Encoder capacity is checked before simulation advances; finite
queues avoid growing memory. Video submission rejects missing indexes rather
than synthesizing repeats, including at stop. PNG frames likewise keep consecutive
indexes. Manual stop seals its time boundary, drains pending frames, then flushes.

Stop returns its job promptly while capture debt and encoder buffers drain. The
status bar shows Finishing capture; MCP clients continue polling rav_media_status.
A stop command can continue past 60 seconds when frame/encoder progress advances.
Progress acknowledgements renew an inactivity deadline, never a total-job limit;
repeated unchanged heartbeats do not extend it. Preparation installs cancellation
ownership before any image decode, and late decoded resources are released after
cancellation without starting another capture.

Check `capture_clock.max_lag_ms` and active `capture_clock.lag_ms` as well as
capture counts: rendering every simulation frame does not prove that an overloaded
device kept up with wall time. Sustained lag can affect unscheduled live inputs.
The video receipt reports `repeated_frames: 0` only after contiguous submission
and full encoding; native `frame_count - received_frames` covers PNG delivery.
Timeline export separately samples every requested frame and can take longer
than real time without missing simulation samples.

`rav_record_start` also accepts an `interactions` schedule. Each operation has
`at_seconds` and is applied on the recording clock before drawing: typed VM
values, triggers, image replacement/clear, or normalized mouse events. Root,
nested, global and list-item VM paths reuse the existing accessor resolution.
Images are validated and decoded before the clock starts. Status and completion
include `interaction_schedule` receipts with requested/applied times, lateness
and frame index; image bytes are excluded. Events at or beyond an explicit stop
time are rejected. See [scheduled interactions](MEDIA_INTERACTION_SCHEDULE.md)
and [raw MCP argument validation](MEDIA_REQUEST_VALIDATION.md).

## Technical references

The host validates source and session identity and owns capture; native jobs own
frame storage, encoding, validation, and publication. Native calls wrap
snake_case fields in `request`; MCP arguments are unwrapped tool arguments.
Refer to the [MCP schemas](../mcp-server/tools/media-tools.json),
[scheduled interaction guide](MEDIA_INTERACTION_SCHEDULE.md), and
[raw request validation guide](MEDIA_REQUEST_VALIDATION.md) when building an
automation client.
