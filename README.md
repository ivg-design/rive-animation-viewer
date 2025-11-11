# Rive Animation Viewer

A responsive local + desktop viewer for `.riv` files with runtime/layout controls, inline JSON config editing, and Tauri packaging.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

The browser will automatically open at `http://localhost:8080`.  
Need a headless server for tooling (e.g., Tauri dev)? Use `npm run serve` instead, which skips auto-opening a tab.

## Usage

### Toolbar & file loading
- Use the unified toolbar to pick a `.riv` file, switch runtimes (Canvas/WebGL2), change layout fit, and access playback icons.
- Toggle the "Config Panel" button in the toolbar to collapse or expand the initialization JSON panel and version info card.
- On the desktop build, use **Make Demo File** to package the currently loaded animation into a standalone viewer (experimental).

### Upload or drag & drop
- Click "Choose File" and select a `.riv` file from your computer **or** drag & drop it onto the canvas area.
- Pick the runtime (Canvas/WebGL2) and layout fit (`contain`, `cover`, `scaleDown`, etc.) from the dropdowns before or after loading.
- The viewer reloads automatically any time you change runtime or layout.

### Initialization config

- The panel on the right accepts **valid JSON** that is merged into the Rive initialization options (e.g., `artboard`, `stateMachines`, `autoBind`).
- Invalid JSON is rejected up front so it cannot crash the viewer.
- Use `Apply & Reload` after editing to reinitialize the currently loaded file.

## Controls

- **Play**: Start/resume the animation
- **Pause**: Pause the animation
- **Reset**: Reset the animation to the beginning

## Features

- Drag & drop file upload support plus file-picker input
- Runtime toggle between Canvas and WebGL2 (always pulled from the latest CDN build)
- Layout-fit dropdown that maps to Rive's built-in Layout options
- Icon-based playback controls inline with the main toolbar
- Responsive design with automatic canvas resizing and collapsible config/version panel
- Installable Progressive Web App (PWA) with offline shell caching
- Desktop wrapper powered by Tauri (macOS-ready `.app` / `.dmg`)

## PWA / standalone usage

- The project now ships a `manifest.webmanifest` and `service-worker.js`, so when it's served over HTTPS (or `http://localhost`) modern browsers will offer an _Install_ button.
- To try it locally, run `npm start`, open the app, and use the browser's install prompt (e.g., Chrome's menu → "Install Rive Animation Viewer").
- For production, deploy the static files (`index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `service-worker.js`, `icons/`) to any HTTPS host (GitHub Pages, Netlify, etc.). The service worker will cache the app shell for offline use, while Rive runtimes continue to stream from the CDN so you're always on the latest build.

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
- Hit **Make Demo File** in the toolbar to bundle the current animation alongside the cached runtime. The tool uses the cached CDN runtime (Canvas/WebGL2) so once fetched it can produce offline demos.
- The generated mini-viewer is a single self-contained HTML file with embedded runtime + animation that you can double-click to preview; it only exposes the canvas and playback controls, omitting file inputs or config editing.

## Folder Structure

```
rive-local/
├── animations/          # Optional local assets (not copied into dist/)
├── dist/                # Build artifact consumed by Tauri packaging
├── icons/               # PWA icon assets
├── index.html          # Main viewer page
├── manifest.webmanifest # PWA manifest
├── package.json        # Dependencies and scripts
├── scripts/             # Utility scripts (e.g., build-dist.mjs)
├── service-worker.js   # Caches the app shell for offline/PWA usage
├── src-tauri/           # Tauri Rust project & bundler config
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
- The server runs on port 8080 by default.
- The desktop app caches the resolved runtime scripts locally so it can launch offline and reuse those scripts when producing demo bundles.

## License & attribution

Copyright © IVG Design. Released under the [MIT License](./LICENSE).

Rive runtimes and related assets are provided by [Rive](https://rive.app/) and remain subject to Rive's licensing.
