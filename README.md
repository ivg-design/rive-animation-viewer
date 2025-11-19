# Rive Animation Viewer

A local and desktop viewer for `.riv` files with runtime controls, JavaScript configuration editing, and ViewModelInstance debugging tools.

## Quick Start

```bash
npm install
npm start  # Opens browser at http://localhost:8080
```

## Features

### Core Viewer
- **File Loading**: Standard file input to load `.riv` files
- **Runtime Selection**: Toggle between Canvas and WebGL2 renderers
- **Layout Options**: Choose from contain, cover, fill, fit-width, fit-height, scale-down, scale-up
- **Background Color**: Color picker to change canvas background
- **Playback Controls**: Play, pause, and reset animation buttons
- **State Machine Detection**: Automatically detects and initializes available state machines

### Code Editor Panel
- **CodeMirror 6 Editor**: JavaScript syntax highlighting with One Dark theme
- **JavaScript Configuration**: Write JavaScript objects (NOT JSON) for Rive initialization
- **Apply & Reload**: Button to apply configuration and reload animation
- **Tab Support**: Tab inserts 2 spaces, Shift+Tab removes indentation
- **Error Display**: Shows errors in red banner when configuration fails

**Important**: The editor accepts JavaScript code, not JSON. You can use JavaScript features like comments, trailing commas, and unquoted keys:

```javascript
{
  // This is a valid comment
  artboard: "MyArtboard",
  stateMachines: ["StateMachine1"],
  autoplay: true,
}
```

### ViewModelInstance Explorer
Developer tool for debugging Rive files with ViewModelInstances.

#### How to Use
1. Load a Rive file
2. Click "Inject VM Explorer" button in toolbar
3. Open browser console (F12 or Cmd+Option+I)
4. Use the following commands:

```javascript
vmExplore()                  // Show root properties
vmExplore("path/to/prop")    // Navigate to specific path
vmGet("settings/volume")     // Get value
vmSet("settings/volume", 0.5) // Set value
vmTree                       // View full hierarchy
vmPaths                      // List all property paths
```

The explorer displays a comprehensive usage guide in the console when injected.

### Desktop Features (Tauri)
- **Native App**: Runs as a desktop application on macOS/Windows/Linux
- **Demo Bundle Export**: Create self-contained HTML files with embedded animations
- **Offline Support**: Caches runtime scripts for offline use
- **Dev Tools Access**: Programmatic DevTools opening via inject button to access console

## Project Structure

```
rive-local/
├── app.js                    # Main application logic
├── vm-explorer-snippet.js   # ViewModelInstance explorer tool
├── index.html               # Main UI
├── style.css                # Styles
├── vendor/
│   └── codemirror-bundle.js # Bundled CodeMirror
├── scripts/
│   ├── build-dist.mjs       # Production build
│   └── bundle-codemirror.mjs # CodeMirror bundler
└── src-tauri/               # Rust/Tauri desktop wrapper
```

## Desktop Development

### Prerequisites
- Rust toolchain (`rustup`)
- Node.js 16+
- Xcode Command Line Tools (macOS)

### Build Commands
```bash
npm run tauri dev   # Development mode
npm run tauri build # Production build
```

## Technical Details

### Configuration Format
The editor uses `eval()` to evaluate JavaScript code, allowing full JavaScript syntax:

```javascript
{
  artboard: "Main",
  stateMachines: ["State Machine 1"],
  autoplay: true,
  layout: {
    fit: "contain",
    alignment: "center"
  },
  // Custom onLoad callback
  onLoad: () => {
    console.log("Animation loaded!");
    riveInst.resizeDrawingSurfaceToCanvas();
  }
}
```

### Error Handling
- Configuration errors display in a red error banner
- Errors auto-dismiss after 5 seconds
- Invalid JavaScript shows syntax errors
- File loading errors display detailed messages

### Tab Key Implementation
The editor intercepts Tab key events when focused:
- Captures keydown events in capture phase
- Prevents default browser tab behavior
- Manually inserts/removes spaces at cursor position

### VM Explorer Architecture
- Loaded as external module from `vm-explorer-snippet.js`
- Walks ViewModelInstance property trees recursively
- Builds path references for direct access
- Uses Rive runtime's path resolution for get/set operations

## Known Issues

### CSP Warnings (Desktop)
The desktop app shows harmless CSP warnings about `blob://` URLs. These are WebKit quirks and don't affect functionality.

### DMG Creation
DMG bundling may fail on some systems. The `.app` bundle in `src-tauri/target/release/bundle/macos/` works regardless.

### Tab Key
Tab indentation only works when the editor has focus. Click in the editor area before using Tab.

## Troubleshooting

**Animation won't load**
- Check browser console for errors
- Verify the .riv file is valid
- Try a different runtime (Canvas vs WebGL2)

**Configuration won't apply**
- Ensure you're writing valid JavaScript (not JSON)
- Check for syntax errors in the code
- Look for error messages in the red banner

**VM Explorer not working**
- Verify your Rive file has ViewModelInstances
- Check console for injection confirmation
- Try reloading after injection

**Desktop build fails**
- Run `rustup update` to ensure latest Rust
- Check `npm run tauri info` for missing dependencies
- Verify Xcode Command Line Tools installed (macOS)

## License

MIT License - Copyright © 2025 IVG Design

Rive runtimes are provided by [Rive](https://rive.app/) under their own licensing terms.