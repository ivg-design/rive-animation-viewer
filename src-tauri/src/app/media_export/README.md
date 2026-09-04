# Native media encoder service

## Integration

`app/mod.rs`, Cargo, main command registration and ACLs integrate these commands:

```rust
media_export_capabilities
media_export_begin
media_export_frame
media_export_finish
media_export_cancel
media_export_status
```

No Tauri managed state. Only new app dependency: `png = "0.17.16"`.
Existing dependencies used: base64, serde, serde_json, sha2, uuid, tokio, rfd.
The configuration hook is in
`src-tauri/src/app/support/media.rs`.

Before the first command, call `configure(EncoderConfig { ffmpeg, ffprobe,
gifski, provenance, distribution })`. Each `TrustedBinary` contains an absolute
`PathBuf`, byte size, and SHA-256 hex string. Optional gifski is
`Option<TrustedBinary>`. Production requires approved `DistributionMetadata`;
DEV local tools deliberately use `distribution: None`.
Optimized isolated DEV must use that hook too: `debug_assertions` is false.
Discovery verifies hashes, probes executable versions, actually encodes and fully
decodes each advertised format, and verifies decoded WebM alpha. No PATH search.
Debug-only convenience discovery checks fixed Homebrew/system locations.

## Implemented behavior and bounds

- Strict typed request arguments; no shell, arbitrary command arguments or URL inputs.
- UUID jobs; first index zero; strictly increasing indices; gaps and final holds
  preserve CFR duration. Static images require exactly one frame. Zero frames fail.
- One active job and one native append at a time; 4,194,304 pixels, 4096 maximum
  edge, rational FPS 1–60, 20 MiB binary chunks and compressed PNG frames.
- Binary append is session-authorized by the parent route and checked again natively.
  PNG bodies are raw PNGs. Encoded bodies are u32LE record-count followed by
  u32LE length + access-unit bytes for each frame. H264/HEVC must be Annex B;
  VP9 records are wrapped in IVF natively. Encoded packet indices start at zero
  and are contiguous; one record per CFR frame, presentation order, no B frames.
- capture_codec is h264/hevc/vp9, matching h264/h265/webm output, with alpha false.
  Omit it for the lossless PNG path. Encoded capture is stream-copied, not re-encoded.
  The parent's WebCodecs quality and hardware selection are never converted to CRF.
- No product duration, frame-count, spool-size, output-size or total job-lifetime caps.
  Counts retain a u32 storage ceiling. The legacy max_frames request field is ignored.
  PNG indices are journaled on disk and sequence generation uses bounded memory.
- Before append, free space must cover current spool bytes + twice incoming stored
  bytes + 128 MiB. Low space seals a nonempty capture and returns stop_reason=disk_space
  with the accepted frame_count; later appends cannot advance it. Finish that exact
  prefix to publish a partial with a warning. Zero accepted frames is an error.
  This budgets a source-sized final copy; it is not an OS reservation. Finalization
  may consume the reservation down to an 8 MiB emergency floor. Unexpected space
  failure retains the spool for recovery instead of discarding accepted capture.
- 768 MiB sampled child RSS/Windows commit, two encoder threads, 120-second capture
  idle watchdog. Subprocess timeout arguments now mean inactivity, not total runtime.
  Frame progress and output changes reset the watchdog; repeated stderr does not.
- CRC, dimension and full PNG decode checks remain. Ancillary metadata is stripped
  without interpretation; APNG and unknown critical chunks are rejected as uploads.
- Long GIF auto falls back to FFmpeg beyond the platform gifski argument bound;
  explicit gifski or advanced motion/lossy controls fail clearly, never silently drop.
- FFmpeg stdout reports encoding progress; GIF retries expose bounded encoding stages.
  Finish starts a background worker immediately. Cancel stops/reaps the encoder before
  cleanup; an in-flight cancel remains `encoding` until cleanup reports `cancelled`.
- Lossless master retained across at most five GIF attempts; resampling selects source
  frames and adjusts presentation rate without shortening duration. Small: 480/12 FPS;
  Balanced: 960/20 FPS; neither upscales. Unmet targets publish the smallest result and
  return `target_met:false`. `quality_only` never changes dimensions/FPS.
- FFmpeg GIF and gifski are explicit adapters. Unsupported motion/lossy controls fail.
  GIF timing is quantized and measured; gifski's OS argument-size guard can reject large
  input lists (Windows has a smaller limit); use FFmpeg GIF or lower capture FPS then.
- H.264/H.265 are opaque. VP9 supports alpha, APNG preserves timing (including one-frame
  APNG), GIF binary alpha, PNG alpha, JPG matte, WebP alpha/lossy or quality=100 lossless.
- Candidates stay on the destination filesystem. Metadata probe plus one strict full output decode, codec, dimensions,
  frame count and animation duration are checked before publication. `overwrite:false`
  uses atomic hard-link creation, so a competing writer wins safely. Explicit overwrite
  uses atomic rename. Cancellation/error removes candidate/master/journal. Initialization
  reaps only known-dead owners. Live, unknown, legacy and recovery-retained journals
  are never deleted merely because they are old.

## Verification commands (no app build)

From the repository root:

```sh
node src-tauri/src/app/media_export/tests/run.mjs --lib
node src-tauri/src/app/media_export/tests/run.mjs check --target x86_64-pc-windows-msvc
node src-tauri/src/app/media_export/tests/run.mjs clippy --all-targets -- -D warnings
# Supply verified local test tools and a PNG captured by desktop RAV:
RAV_TEST_GIFSKI=/absolute/path/to/gifski RAV_TEST_BROWSER_PNG=/absolute/path/to/desktop-capture.png node src-tauri/src/app/media_export/tests/run.mjs -- --include-ignored --nocapture --test-threads=1
```

`tests/lib.rs` imports the actual backend source files without Tauri/main/build.rs.
`tests/unit.rs` covers strict options, CRC/decode bounds, generated legal WebKit-style
eXIf, held-frame sampling, both presets, cancellation/zero-frame jobs, checksum refusal,
path validation, two competing writers, and abandoned-owner cleanup.
`tests/smoke.rs` encodes/decodes all eight formats, checks held-frame colors, fractional
and opaque alpha, matte colors, rational FPS, both target policies, one-frame GIF/APNG,
WebP lossless, cancellation after the encoder starts, and the actual desktop PNG.
Only a generated eXIf sample is committed in test code; desktop pixels remain in temp.

The initial built desktop b0185 export failed before frame zero because its legitimate
eXIf chunk was rejected. That failure is not erased by synthetic smoke success.
The corrected backend accepted the actual 1563x1278 WebKit fixture. Subsequent
rebuilt desktop tests exported every format and verified decoded motion/alpha;
see the [implementation receipt](../../../../reports/2026-09-03-v2.5.5-implementation-receipt.md).
Windows MSVC cross-target compilation is verified; Windows runtime is not tested on
this Mac. Linux runtime, full-resolution stress and distribution remain integration gates.
RSS/disk checks are sampled safeguards, not kernel-enforced process resource quotas.

## Distribution boundary

No encoder binaries are committed or approved by this module. Local FFmpeg/ffprobe
and gifski installations are DEV test inputs only and are never copied into a bundle.
Production now fails closed unless `src-tauri/encoder-resources/encoders` was created
from an explicit release inventory by the deterministic distribution gate. That gate
requires target-specific hashes/sizes, upstream artifact and source provenance,
license notices and redistribution review, and nested code signatures; runtime repeats
the manifest and byte-integrity checks. See
`src-tauri/encoder-distribution/README.md` for the schema, staging, verification, and
final-bundle procedure.

FFmpeg obligations depend on its exact build configuration. Gifski offers
AGPL-3.0-or-later and alternative commercial terms upstream. A separate process is not
a license exemption. At present there is no approved production inventory, so
`distribution.ready` remains false and the production build gate intentionally fails.

September 3 integration rerun: **12 passed, 0 failed** (9 unit + 3 actual-artifact
tests), 22.96 seconds. The implementation receipt retains the verification
summary without publishing private fixture paths or animation pixels.
