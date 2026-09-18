# Idea: Open RML in RAV

Captured: 2026-09-10

Status: Parked feature idea for future design

Origin: rive-cli 0.1.22 investigation (live-link protocol capture, signing
tests in web runtime 2.42.0).

## Concept

The Open button accepts an `.rml` file (or a directory containing `rive.yaml`).
RAV calls the rive-cli compiler, compiles the project, and opens the resulting
`.riv` exactly like any other file. Subsequent saves to the project reload
automatically. RAV becomes the player for CLI/agent-authored projects, with
the VM controls, event log, MCP and media export that the CLI's own watch
window does not have.

## How RML playback works (verified)

Nothing plays RML. The `rive` binary (28 MB Rust; embeds the C++ runtime, a
wgpu/Metal renderer, the Luau compiler and a WGSL/naga compiler) parses the
RML, compiles scripts and shaders, serializes a `.riv`, re-imports it as a
self-check, and loads those bytes into its runtime. There is no library or
API; the only way to use the compiler is to spawn the binary.

### Live-link protocol (undocumented; captured by observation)

`rive <dir> --serve[=port]` / `--headless-serve` opens a plain WebSocket on
`127.0.0.1:9640` (`rive doctor` reports the port). On connect it pushes the
current build; on every save it rebuilds (~200 ms) and pushes again.

Frame: 12-byte header `RVLK` · u16 version=1 · u16 type · u32 payload length;
payload starts with u32 build sequence.

| type | payload |
| --- | --- |
| 4 | begin: `seq, riv_size, flags=0, name_len, name` |
| 5 | bytes: `seq, <riv bytes>` (standard `RIVE` magic; chunkable) |
| 6 | end: `seq` |

RAV's file inspection read a pushed build correctly (artboard, SM, nested
VM). Gate on `version == 1`; the protocol is private.

### Signing (the design constraint)

| Build | Size (sample) | Loads in web 2.42.0 | Scripts |
| --- | --- | --- | --- |
| watch / `--serve` / `--once` (unsigned) | 2,249 B | yes; VM/SM readable | refused: `ScriptAsset doesn't have a generator function main`; the `ScriptedLayout` draws nothing |
| `--publish` (signed; login + network, ~1.7 s) | 17,923 B | yes | run (`vm speed: 3.5` logged) |

`--publish` is one-shot (writes `build/<name>.riv`, exits, does not serve) and
watermarked until `rive push` binds the project to a cloud file. The CLI's own
window plays unsigned scripts, so this only surfaces in web runtimes, i.e. in
RAV. Rive documents this as deliberate.

## What it entails

1. Open target: `.rml` file or directory with `rive.yaml` → project mode; build
   name from `rive.yaml`. Add `rml` to the picker filter; drag-and-drop too.
2. Binary discovery: `PATH`, `~/.rive/bin`, `/opt/homebrew/Caskroom/rive-cli/*`.
   Version-gate; show an install hint (`brew install --cask rive-app/tap/rive-cli`)
   when absent.
3. Process management: spawn `rive <dir> --headless-serve=<free port> --quiet`
   as a child; parse log lines (`[time] error main:15:12 [type] …`) into the
   error banner and event log; kill on close, file switch and app exit. Use a
   free port rather than 9640 so the user's own watch window is not disturbed.
4. Live-link client in the host: reassemble type 4/5/6 frames and feed the
   bytes into the existing file-session replacement path (VM control snapshot
   restore, in-flight recording cancellation, source identity all exist).
5. Script handling: file inspection already sees `ScriptAsset`s, so RAV can show
   "unsigned build: scripts do not run in the web runtime" and offer
   **Publish & reload** (`rive <dir> --publish`, then load `build/<name>.riv`).
   Script-free projects need nothing; the unsigned push is fully playable.
6. MCP: `rav_open_project`, `rav_project_status` (last build errors/warnings),
   `rav_project_publish`.
7. Optional: "copy repro command" that turns a RAV interaction schedule into
   `rive <dir> --screenshot --data=… --pointer=… --advance=…` (same vocabulary).

## Consequence to state plainly

Scripted projects are a two-speed loop in RAV: instant for structure, VM and
SM changes; ~2 s plus network for script changes via Publish. Unscripted
projects are instant end to end.

## Sizing

M. The loading side already exists; the work is the child-process wrapper,
log surfacing, the WebSocket client and the signing UX.

## Resume point

Prototype the live-link client against `rive <sample> --headless-serve` and
the existing open-file path, then add the process wrapper. Decide whether
Publish & reload is in the first cut or a follow-up.
