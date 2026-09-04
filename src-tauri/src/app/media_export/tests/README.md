# Standalone native media harness

Run this harness only through `run.mjs`. It fixes `CARGO_TARGET_DIR` to
`src-tauri/target-media-harness`, removes any legacy nested target before startup,
and fails if Cargo creates `tests/target`. The local `.cargo/config.toml` provides
the same external target when Cargo is launched from this directory; `.gitignore`
is a final guard for an incorrectly invoked command.

From the repository root:

```sh
node --test src-tauri/src/app/media_export/tests/harness-target.node.mjs
node src-tauri/src/app/media_export/tests/run.mjs --lib
node src-tauri/src/app/media_export/tests/run.mjs check --target x86_64-pc-windows-msvc
node src-tauri/src/app/media_export/tests/run.mjs clippy --all-targets -- -D warnings
```

Actual encoder smoke tests use explicit local test tools. They validate behavior but
do not establish redistribution permission and never copy those tools:

```sh
RAV_TEST_GIFSKI=/absolute/path/to/gifski \
RAV_TEST_BROWSER_PNG=/absolute/path/to/desktop-capture.png \
node src-tauri/src/app/media_export/tests/run.mjs \
  -- --include-ignored --nocapture --test-threads=1
```
