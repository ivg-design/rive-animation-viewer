# Rive Animation Viewer

A responsive local + desktop viewer for `.riv` files with runtime/layout controls, inline JSON config editing, and Tauri packaging.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Start the Vite dev server (hot reload + auto-open):
```bash
npm start
```

The browser will automatically open at `http://localhost:8080` with live reload.  
Need a headless server for tooling (e.g., when Tauri spawns its own window)? Use `npm run serve`, which skips auto-opening a tab.

## Usage

### Toolbar & file loading
- Use the unified toolbar to pick a `.riv` file. The button stays blue until a file is loaded, then turns green and displays the file name (click again to clear and pick another file).
- Switch runtimes (Canvas/WebGL2), change layout fit, pick a background color swatch, and access the playback icons from the same row.
- Tap the square **Settings** toggle to collapse/expand the JSON editor panel; the version card lives at the bottom of that panel.
- On the desktop build, **Make Demo File** packages the currently loaded animation into a self-contained viewer (HTML export today; native bundle via CI is recommended).

### Uploading files
- Click the `Choose File` button and select a `.riv` file from your computer.
- Adjust runtime/layout/background color either before or after loading; the viewer reloads automatically whenever you change runtime/layout.

### Initialization config

- The panel on the right accepts **valid JSON** that is merged into the Rive initialization options (e.g., `artboard`, `stateMachines`, `autoBind`).
- Invalid JSON is rejected up front so it cannot crash the viewer.
- Use `Apply & Reload` after editing to reinitialize the currently loaded file.

## Controls

- **Play**: Start/resume the animation
- **Pause**: Pause the animation
- **Reset**: Reset the animation to the beginning

## Features

- Custom file picker with clear/load behavior
- Runtime toggle between Canvas and WebGL2 (always pulled from the official CDN)
- Layout-fit dropdown that mirrors Rive’s built-in layout options
- Icon-based playback controls inline with the main toolbar
- Responsive design with a square Settings toggle, compact mode (≤800 px) that fits all controls in two rows, and a live background-color picker shared with demo bundles
- Version card pinned to the Settings panel showing release + runtime info
- Desktop wrapper powered by Tauri (macOS-ready `.app` / `.dmg`)
- Vite-based dev server for instant feedback—no more cache-clearing scripts or manual reloads
- **Fullscreen mode** in demo bundles with hover-activated UI restore for distraction-free animation viewing

## Desktop app (Tauri)

Tauri lets you run the viewer as a first-class macOS app (and build installers) without changing the front-end.

### Prerequisites
- Rust toolchain (`rustup` + `cargo`), Xcode Command Line Tools
- Node.js (already required for the web workflow)

### Commands
```bash
npm run tauri dev   # launches the Tauri shell + local http-server
npm run tauri build # produces a signed-release bundle in src-tauri/target/
```

The Tauri CLI automatically runs `npm run serve` in dev mode and `npm run build` before packaging, so your static assets stay in sync.

### Demo bundle workflow (desktop-only)
- Load your `.riv` file, configure the desired runtime/layout/state machines, and verify playback.
- Hit **Make Demo File** in the toolbar to bundle the current animation alongside the cached runtime.
- The generated mini-viewer is a self-contained HTML file with embedded runtime + animation that you can double-click to preview; it only exposes the canvas and playback controls, omitting file inputs or config editing.
- **Fullscreen mode**: Demo bundles include a fullscreen button that hides all UI controls for an immersive viewing experience. To restore the UI, hover your mouse in the bottom-right corner for 1 second to reveal the expand icon, then click it to return to normal view.
- Our GitHub CI/CD workflow publishes three binaries per release: macOS (Apple Silicon), macOS (Intel), and Windows. Grab the latest installers from the [Releases](../../releases) tab if you just need the desktop builds.

## Folder Structure

```
rive-local/
├── animations/        # Optional local assets (not copied into dist/)
├── dist/              # Build artifact consumed by Tauri packaging
├── icons/             # Shared app icons (favicon + desktop)
├── index.html         # Main viewer page
├── package.json       # Dependencies and scripts
├── scripts/           # Utility scripts (e.g., build-dist.mjs)
├── src-tauri/         # Tauri Rust project & bundler config
└── README.md          # This file
```

## Requirements

- Node.js (for running the local server)
- Modern web browser with canvas support
- Rust toolchain + Xcode CLT (only if you plan to build the Tauri desktop app)

## Notes

- The viewer always loads the latest official Rive runtimes from the CDN for both Canvas and WebGL2 modes (`@rive-app/...@latest`). No runtime code is bundled, so you always get the newest build at launch.
- Sample `.riv` files in `animations/` are for local reference only and are intentionally excluded from `dist/` and packaged apps to keep bundles lean.
- Animations are played using the HTML canvas element with dynamic resizing.
- The server runs on port 8080 by default (configurable via Vite flags).
- There is no service worker/PWA shell anymore, so dev builds never get stuck behind stale caches.
- The desktop app caches the resolved runtime scripts locally so it can launch offline and reuse those scripts when producing demo bundles.

## License & attribution

Copyright © IVG Design. Released under the [MIT License](./LICENSE).

Rive runtimes and related assets are provided by [Rive](https://rive.app/) and remain subject to Rive's licensing.
