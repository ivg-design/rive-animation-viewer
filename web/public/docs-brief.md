# RAV Documentation Brief

RAV (Rive Animation Viewer) is a desktop tool for loading `.riv` files, inspecting ViewModel inputs, testing playback, and exporting rendered media or web code.

Playback runs in a dedicated WebView while controls and diagnostics remain in the main interface. RAV keeps the last confirmed frame visible while a replacement file, artboard, playback target, or ViewModel instance loads. Timeline preview includes a draggable frame/seconds scrubber; state-machine preview supports live interaction.

The Properties panel exposes root, nested, list, authored-instance, and global ViewModel values. Reset restores the authored playback and control state. Standalone HTML includes its runtime and user interface, while CDN/local snippets contain setup plus only the selected typed property accessors.

Desktop media export supports H.264, H.265, WebM, APNG, GIF, PNG, JPG, and WebP when the bundled capability check approves the selected format. Timelines export at full duration or over an exact segment. State machines can be recorded with pointer and ViewModel interaction, an optional cursor, manual or timed stop, and no product duration ceiling. GIF controls can reduce dimensions, frame rate, and quality or search for a target size. Progress appears in the bottom status bar.

RAV includes a bundled native MCP sidecar with 57 tools for file, playback, ViewModel, console, screenshot, standalone-export, and media-export automation. The macOS app can deliberately claim `.riv` ownership and repair its document icon; Windows installers register the matching document icon. Anonymous Usage can be disabled in Settings; see the Privacy page for the exact disclosure.

Core pages:
- https://forge.mograph.life/apps/rav
- https://forge.mograph.life/apps/rav/docs
- https://forge.mograph.life/apps/rav/changelog
