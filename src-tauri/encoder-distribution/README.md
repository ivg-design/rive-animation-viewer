# Production encoder acquisition and distribution

RAV production builds use only `ffmpeg` and `ffprobe` from the pinned Jellyfin
FFmpeg `v7.1.4-3` GPL portable release. Production does not discover encoders on
`PATH`, copy Homebrew/MacPorts installations, or ship gifski. Gifski remains a
development-only optional tool elsewhere in RAV.

No encoder binary is committed. Release CI downloads approved archives into an
explicit cache, verifies them before extraction, extracts only the declared
executables, creates the license/provenance inventory, and stages the ignored
`src-tauri/encoder-resources/encoders` directory.

## Approved Jellyfin release

The machine-readable authority is
`jellyfin-ffmpeg-v7.1.4-3.json`. It pins these upstream assets:

| Rust target | Portable asset | SHA-256 |
| --- | --- | --- |
| `aarch64-apple-darwin` | `jellyfin-ffmpeg_7.1.4-3_portable_macarm64-gpl.tar.xz` | `99d689816a41075574928a0b3059101fd454fc58f465c99105a73b5c415ac86d` |
| `x86_64-apple-darwin` | `jellyfin-ffmpeg_7.1.4-3_portable_mac64-gpl.tar.xz` | `943f78e94d2760d3925fc0d9cc15f8329b11dbcdae7b0fd0d225b64e5a1aae29` |
| `x86_64-pc-windows-msvc` | `jellyfin-ffmpeg_7.1.4-3_portable_win64-clang-gpl.zip` | `113adeb702683c38be40a65d859f8ef7ffb07bae9df16dfb6c3df5ac3d95ef3c` |

The corresponding source is the exact tag archive:

- URL: `https://github.com/jellyfin/jellyfin-ffmpeg/archive/refs/tags/v7.1.4-3.tar.gz`
- independently observed SHA-256:
  `38fff90f73b3c4f9c3c7270711411a4ec3cbe63b205d4b4a5525bcc532d3d31f`
- size: `16,698,965` bytes

The acquisition step extracts `COPYING.GPLv3`, FFmpeg's `LICENSE.md`, and the
Jellyfin Debian copyright inventory from that hash-pinned source archive. Each
generated inventory records those exact staged documents, the release artifact
URL/hash, corresponding-source URL/hash, exact post-signing binary hashes and sizes,
embedded build configuration, and license/review basis. The approved SPDX expression
is `GPL-3.0-or-later`, consistent with a build that enables both `--enable-gpl` and
`--enable-version3`.

The checker requires the exact `7.1.4-Jellyfin` version marker, requires
`--enable-gpl` and `--enable-version3`, and rejects `--enable-nonfree`. It verifies
Mach-O or PE architecture and refuses cross-OS inspection. A macOS host may inspect
either approved Mach-O architecture with `/usr/bin/file`, `lipo`, `otool`, and
`codesign`; this supports opposite-architecture release-matrix staging without
allowing a macOS runner to approve Windows bytes.

## Release CI command

`--work-dir`, `--cache-dir`, and `--output` must be absolute and non-overlapping.
The work directory must not already exist. A matching cache entry is reused only
after its size and SHA-256 pass; a corrupt cache fails closed. The output directory
is replaced atomically only after complete verification. Work and cache directories
inside the repository are rejected; the only repository output permitted is the
ignored `src-tauri/encoder-resources/encoders` directory.

```sh
node scripts/encoder-distribution/encoders.mjs acquire \
  --target "$RAV_ENCODER_TARGET" \
  --work-dir "$RUNNER_TEMP/rav-encoder-work-$RAV_ENCODER_TARGET" \
  --cache-dir "$RUNNER_TEMP/rav-encoder-cache" \
  --output "$PWD/src-tauri/encoder-resources/encoders" \
  --mac-signing-identity "$APPLE_SIGNING_IDENTITY"

node scripts/encoder-distribution/encoders.mjs verify \
  --target "$RAV_ENCODER_TARGET" \
  --directory "$PWD/src-tauri/encoder-resources/encoders"
```

Omit `--mac-signing-identity` on Windows. On macOS, production CI should always pass
its Developer ID Application identity. The arm64 upstream binaries currently carry
linker ad-hoc signatures, while the x86_64 archive is unsigned; local x86_64
cross-architecture inspection can use `--mac-signing-identity -`. The optional
signing identity applies only to the two declared executables before their final
hashes and provenance are generated.

`RAV_ENCODER_TARGET` is also read when `--target` is omitted. This is how the Tauri
production prebuild verifier checks the intended matrix target instead of assuming
`process.arch`. With neither an option nor the environment variable, native-host
operation is used.

An already prepared, separately controlled source tree can still use the lower-level
stager:

```sh
node scripts/encoder-distribution/encoders.mjs stage \
  --target "$RAV_ENCODER_TARGET" \
  --inventory /absolute/release-control/inventory.json \
  --source-dir /absolute/reviewed-encoder-input \
  --output "$PWD/src-tauri/encoder-resources/encoders"
```

The stager rejects symlinks, package-manager roots, undeclared files and directories,
hash/size changes, unsafe paths, bad executable modes, native dependency drift, and
invalid signatures. It writes canonical sorted JSON, fixed modes/timestamps, and an
exact runtime manifest.

## Verification and local acceptance

Offline tests use synthetic, test-owned fixtures and never redistribute encoder
bytes:

```sh
node --test scripts/encoder-distribution/tests/*.node.mjs
```

The live test is opt-in. It downloads the pinned native release into a temporary or
explicit cache, validates the real executable metadata, stages it outside tracked
source, and removes its temporary work/output afterward:

```sh
RAV_ENCODER_LIVE=1 \
RAV_ENCODER_CACHE="$HOME/Library/Caches/RAV/encoders" \
node --test scripts/encoder-distribution/tests/live-acquisition.node.mjs
```

For production-equivalent local acceptance, run `acquire` with three fresh absolute
directories, run `verify` with the same target, build the desktop app, then exercise
every media format with a real `.riv`. Browser tests cannot close desktop export
acceptance.

After signing and notarizing the final app, verify the staged bytes again, every
nested encoder signature, the app signature, stapled ticket, and Gatekeeper result:

```sh
node scripts/encoder-distribution/encoders.mjs verify-bundle \
  --target "$RAV_ENCODER_TARGET" \
  --app /absolute/path/to/Rive\ Animation\ Viewer.app
```

The generated resource directory is ignored release output. A clean checkout remains
source-only after acquisition when the explicit work, cache, and staged output
directories are removed.
