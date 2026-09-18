# RAV idea: Native alpha recorder

Captured: 2026-09-11

Status: Proposed for 2.6; gated on a two-hour Apple-runtime/Metal feasibility spike

Origin: 2.5.6 recording close-out and lossless capture transport measurements

## Concept

Record an event log in RAV, then replay it in a native Swift sidecar linked to a
pinned Apple `RiveRuntime.xcframework`. The sidecar advances the selected state
machine at the output frame rate, renders into a Metal texture, and feeds pixels
to the existing trusted ffmpeg distribution. PNG sequence, ProRes 4444, APNG, and
WebM-alpha no longer need to transport encoded PNG frames out of a WebView.

The first version is **offline replay from a reproducible starting state**, not
a promise to clone an arbitrary running WebView. Keep the present recording
backend available as the fallback and make the backend visible in job receipts.

## Problem and existing evidence

The [2.5.6 audit](../../reports/2026-09-11-v2.5.6-audit.md), section 5, records a
2560×1440 heavy-file investigation. After capture moved off the animation thread,
main-thread stalls disappeared and playback recovered to roughly 27–30 Hz, but
lossless/alpha capture still transported approximately 5–8 MB per full-size frame
out of the WebView and topped out near 20 captured frames/s. A smaller 1280×720
APNG experiment reached approximately 50 capture frames/s. Hardware H.264, HEVC,
and opaque VP9 use a different compressed-video path and are not constrained by
this particular PNG-egress bottleneck.

These are **historical measurements supplied with the packet**, not measurements
made by this proposal's author on a newly rebuilt application. They are fixture-
and machine-specific, not a product-wide frame-rate ceiling. The current offline
clock preserves simulation frames but cannot remove the transport work. A native
renderer removes that boundary; GPU rendering, readback, encoder throughput,
memory, and disk remain real limits. No guaranteed realtime rate is proposed.

## Event-log contract

Extend the [interaction schedule](../MEDIA_INTERACTION_SCHEDULE.md), rather than
inventing a second property-path language. A versioned recording manifest owns:

| Record | Required content |
| --- | --- |
| Identity | Event-log schema version; `.riv` byte SHA-256; pinned Apple runtime version/archive SHA-256; RAV build; sidecar build; external asset hashes. Do not replay against a changed file or runtime silently. |
| Initial state | Artboard and state-machine selection; authored/automatic VM binding; root and global typed VM values; supported image overrides; fit/alignment; canvas/output size; background/alpha; GPU Canvas selection; cursor policy. |
| Clock | Rational FPS numerator/denominator; resolved frame count; reset origin/preroll policy. Use integer frame indices and the existing duration-to-frame resolution contract. |
| Operations | Existing `vm-set`, `vm-trigger`, and `pointer` descriptors, augmented internally with `frame_index` and a monotonic sequence number for same-frame ordering. Retain requested time for diagnostics. |
| Completion | Last committed event/frame, stop reason, cancellation state, applied-operation count, and failure diagnostics. Do not serialize secrets or unnecessary live property values into public receipts. |

At frame zero, restore the initial state, apply frame-zero operations, and draw
with zero delta. For each later frame, apply its ordered operations, advance by
exactly `fps.denominator / fps.numerator`, draw once, and acknowledge that frame
only after its pixels have been accepted by the bounded output pipeline. Times
from existing schedules map to the first frame boundary at or after the requested
time, with original input order retained for ties. Do not change the public
`at_seconds` API in the first implementation.

Record actual accepted pointer/VM operations, not DOM clicks or intended writes
that were rejected. Pointer coordinates retain the existing normalized artboard
mapping, including fit, alignment, and letterboxing. V1 keeps the existing single-
pointer event set; it does not introduce keyboard, wheel, or multi-touch support.
Image data must be validated, bounded, content-addressed, and available offline;
network fetches must not introduce timing-dependent replay changes.

## The determinism boundary

A snapshot of exposed VM values **is not a snapshot of all runtime state**.
Elapsed animation time, an in-flight transition, internal script state, random
state, and earlier pointer/trigger history may not be reconstructible from those
values. Therefore V1 starts from an agreed reset/default origin or replays a
recorded preroll from that origin. Reject an unsupported arbitrary mid-session
start instead of promising an exact replica. Capturing VM values alone must not
be labeled deterministic state restoration.

Pinning the runtime also does not prove identical Web and Apple rendering. Add
fixtures for nested VMs, dynamic lists, global values, authored instances, images,
scripted state machines, text/fonts, and GPU Canvas content. Define tolerances for
cross-renderer pixel comparisons and exact assertions for operation/frame order.
Static content can legitimately have identical adjacent frames; duplicate-frame
rejection belongs only to deliberately moving test fixtures.

## Swift sidecar and Metal

The proposed low-level route is `RiveUIRenderer` draw-to-texture, frame advancement
through `advanceBy`, pointer delivery through the runtime's `touch*AtLocation`
family, and data-binding accessors. **Those names describe the requested design,
not a verified callable headless API in the selected binary.** The current Apple
runtime documentation exposes both a newer Swift-first API and a legacy API, and
marks many newer APIs `@MainActor`. The first spike must inspect the exact pinned
XCFramework's public headers/Swift interface and compile a real draw/readback
example. Do not silently depend on private selectors or assume that a view-based
renderer can draw into an arbitrary texture.

Use a versioned release asset and its reviewed checksum, never a mutable `main`
or `latest` dependency. Verify the downloaded archive, architecture slices,
deployment target, license/redistribution terms, code signature expectations, and
runtime feature coverage. The manifest currently visible in the public repository
is evidence that binary-target distribution exists, not evidence that an archive
has been downloaded, verified, or tested here.

A dedicated process owns its runtime objects, main-actor/run-loop requirements,
Metal device, command queue, and render targets. This is independent of the host
WebView's main thread; it does not imply that arbitrary Rive calls are thread-safe.
The implementation must prove that no visible application window is required.
If the packaged API lacks a supported headless route, stop at the spike and
re-estimate a supported bridge or upstream contribution before committing the
remaining implementation budget.

Readback uses a small, bounded pool of GPU/readback buffers, completion signals,
and explicit ownership. Handle pixel format (RGBA versus BGRA), row pitch,
vertical orientation, color space, and premultiplied versus straight alpha.
Wait for GPU completion before consuming pixels; do not call a CPU texture read
on unfinished GPU work or spin-wait on the host. Keep transparent RGB behavior
consistent and test semi-transparent edges as well as fully clear pixels.

## Rust, ffmpeg, and product integration

Rust launches only the bundled, hash-verified sidecar with an argument array and
validated input/output paths. No shell interpolation of filenames or descriptors.
Use versioned, bounded NDJSON control/progress messages; reserve stdout for the
protocol and stderr for diagnostics. Reuse the existing job lifecycle, destination
preflight, overwrite consent, publication/recovery rules, timeout/cancel handling,
and native capture-count event contract. A failed sidecar must not leave a job
marked successful or publish partially verified output.

Stream RGBA frames to the trusted encoder through a bounded pipe or the existing
spool contract. Preserve rational frame timestamps; block before advancing when
output capacity is exhausted. PNG sequence and APNG retain full alpha; ProRes uses
4444/profile 4; WebM-alpha remains capability-probed. Actual decoded pixels—not
container metadata alone—must prove alpha. Keep output formats and existing MCP
argument validation unchanged unless a separately versioned capability explicitly
advertises the new backend selection.

Initially expose an opt-in native/offline backend in UI/MCP capabilities. Existing
platforms and unsupported files continue through the current backend, with an
explicit reason rather than a silent switch. macOS is the first target. Shipping
still requires appropriate sidecar signing/notarization and per-architecture
acceptance; this proposal does not add a Windows native renderer.

## Later: recording concurrently with live playback

The same renderer can eventually consume a live event stream while the WebView
remains the interactive preview. That requires a committed-frame watermark,
acknowledged event sequence numbers, bounded buffering, and a policy for late
input. Wall-time arrival must not mutate an already rendered simulation frame.
Backpressure and lag need visible receipts, not silent dropping. Defer this mode
until offline replay, reset-origin capture, and lifecycle cleanup are proven.

## Scope and calibrated effort

Hours below include preparation and a single final integration/validation tax.
They use the supplied development-estimation skill and measured benchmarks:
patterned work (P) around 500 added source lines/h, novel work (N) around 250/h,
and a two-hour research (R) timebox. Counts are planning estimates, not measured
output. The sidecar's **six-hour serial chunk** is 2 h R plus approximately 1,000 N
lines / 250; extra workers do not shorten that dependency. Stretch is roughly
1.5×. Tests and docs can overlap with that chunk after the contracts are frozen.

| Task | Content (items, lines, P/N/R) | Prep included | Serial path | S0 solo | S1 small team | S2 wide fan-out | S3 (2 trees) | S4 (2 trees) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Feasibility and frozen contracts | This idea plus build plan, protocol and fixtures; R/P | 1 h idea + 2 h plan | Before implementation | 3.0 h (4.5 h) | 3.0 h (4.5 h) | 3.0 h (4.5 h) | 3.0 h (4.5 h) | 3.0 h (4.5 h) |
| Event-log serializer | 2 items; ~500 P lines, typed snapshot + frame-indexed events | ~0.3 h brief/review | Contract shared with sidecar | 1.3 h (2.0 h) | 1.1 h (1.7 h) | 1.1 h (1.7 h) | 1.1 h (1.7 h) | 1.1 h (1.7 h) |
| Swift runtime/Metal sidecar | 3 items; ~1,000 N lines + one R spike | 2 h API/alpha spike | **6 h; gate before scale-up** | 6.0 h (9.0 h) | 6.0 h (9.0 h) | 6.0 h (9.0 h) | 6.0 h (9.0 h) | 6.0 h (9.0 h) |
| Rust process/job wiring | 2 items; ~500 P lines | ~0.3 h brief/review | Native integration after sidecar | 1.3 h (2.0 h) | 1.1 h (1.7 h) | 1.1 h (1.7 h) | 1.1 h (1.7 h) | 1.1 h (1.7 h) |
| MCP/UI capability switch | 1 item; ~350 P lines | ~0.3 h brief/review | Existing APIs stay compatible | 1.0 h (1.5 h) | 0.8 h (1.2 h) | 0.8 h (1.2 h) | 0.8 h (1.2 h) | 0.8 h (1.2 h) |
| Docs and examples | 1 item; three documents, no source-line estimate | ~0.1 h review | Close-out copy | 0.5 h (0.8 h) | 0.5 h (0.8 h) | 0.5 h (0.8 h) | 0.5 h (0.8 h) | 0.5 h (0.8 h) |
| Final integration and native validation | Alpha decode, exact frames/events, cancellation, packaging | ~2.0 h validation + ~0.5 h integration | Serial after both lanes | 2.5 h (3.8 h) | 2.5 h (3.8 h) | 2.5 h (3.8 h) | 2.5 h (3.8 h) | 2.5 h (3.8 h) |
| Additional tree overhead | Two contracts + two merges | 0.5 h contract + 1 h merge per tree | Pure integration overhead | 0 h (0 h) | 0 h (0 h) | 0 h (0 h) | 3.0 h (4.5 h) | 3.0 h (4.5 h) |

There are fewer than six independent patterned implementation chunks and well
under 8,000 source lines. S2 therefore collapses to S1—no wide-worker speedup is
assumed. S3/S4 cannot parallelize the one native renderer and add merge cost.
Task rows are not additive when worker lanes overlap. The S1 critical path is
3 h preparation + max(6 h sidecar, 3.5 h supporting lane) + 2.5 h final validation.
The validation row charges approximately 25% of the 7.7 h solo implementation/
docs anchor once; there is no second blanket multiplier on totals.

| Scenario | Whole feature, expected (stretch) | Recommendation |
| --- | --- | --- |
| S0 solo | 15.6 h (23.4 h) | Viable, but patterned work stays on the serial lane. |
| S1 small team | **11.5 h (17.3 h)** | Recommended: one native owner, one serializer/Rust worker, one mechanical/docs worker, reviewed in one tree. |
| S2 wide fan-out | 11.5 h (17.3 h) | No gain; use the S1 configuration rather than spawn idle workers. |
| S3, 2 small-team trees | 14.5 h (21.8 h) | No critical-path benefit; additional contracts and merges. |
| S4, 2 wide-fan-out trees | 14.5 h (21.8 h) | No gain over S3 at this scope. |

The complete-feature totals include the idea document already delivered here;
remaining S1 implementation/planning work is approximately 10.5 h (15.8 h) under
these assumptions. Do not treat the spike estimate as confirmation that the API
works: a failed headless/alpha spike produces a revised scope, not an invented
completion date. The packet includes benchmarks but no calibration-log history;
no unobserved median correction has been applied. Record actuals when this future
feature is implemented. This close-out did not implement or benchmark the sidecar.

## Acceptance and next decision

The spike must produce a pinned-build Metal texture readback and an ffmpeg output
with visibly and numerically verified semi-transparent pixels. The feature gate
then requires a moving-fixture PNG sequence with exact frame count/order, stable
same-frame event ordering, native versus Web reset-origin comparisons, source/
runtime identity checks, clean cancellation/timeout recovery, memory bounded over
a long run, and a signed packaged run on each supported architecture. Native
frame-count progress must advance before completion.

Proceed only after the first two-hour spike resolves the supported headless API,
alpha representation, deployment target, and licensing questions. Preserve the
current backend until those gates pass.

## References checked for this proposal

- [Rive Apple runtime documentation](https://rive.app/docs/runtimes/apple/apple): new and legacy API distinction, platform support, data binding, main-actor requirements.
- [Rive Apple runtime source and distribution manifest](https://github.com/rive-app/rive-ios/blob/main/Package.swift): versioned binary target and checksum mechanism. Pin an immutable reviewed release before implementation; `main` is an inspection reference only.
- [Apple Metal texture readback API](https://developer.apple.com/documentation/metal/mtltexture/getbytes(_:bytesperrow:from:mipmaplevel:)): texture-to-CPU boundary to validate in the spike.
- [FFmpeg codec documentation](https://ffmpeg.org/ffmpeg-codecs.html): encoder options; actual shipped capabilities remain the authority for RAV.
- [RAV interaction schedule](../MEDIA_INTERACTION_SCHEDULE.md) and [media export contract](../MEDIA_EXPORT.md): existing timing, typed paths, validation and job lifecycle.
