# RAV Documentation Brief

RAV (Rive Animation Viewer) is a desktop tool for loading `.riv` files, inspecting ViewModel inputs, testing playback, and exporting rendered media or web code.

Playback runs in a dedicated WebView while controls and diagnostics remain in the main interface. RAV keeps the last confirmed frame visible while a replacement file, artboard, playback target, or ViewModel instance loads. Timeline preview includes a draggable frame/seconds scrubber; state-machine preview supports live interaction.

The Properties panel exposes root, nested, list, authored-instance, and global ViewModel values. Reset restores the authored playback and control state. Standalone HTML includes its runtime and user interface, while CDN/local snippets contain setup plus only the selected typed property accessors.

Desktop media export supports H.264, H.265, WebM, ProRes 4444, APNG, GIF, PNG, JPG, WebP, and PNG/JPG image sequences when the bundled capability check approves the selected format. A GPU Canvas toggle enables Rive's WebGL2 GPU renderer for desktop playback, standalone HTML, and generated snippets. Timelines export at full duration or over an exact segment. State machines can be recorded with pointer and ViewModel interaction, an optional cursor, manual or timed stop, and no product duration ceiling. GIF controls can reduce dimensions, frame rate, and quality or search for a target size. Recording jobs show live capture counts and dismissable status cards in an auto-sizing overlay in the bottom status bar.

RAV reads artboards, animations, state machines, and ViewModel structure from a parse-once file inspection pass instead of instantiating a Rive runtime, and Properties-drawer ViewModel readouts refresh at the render rate. RAV includes a bundled native MCP sidecar with 55 tools for file, playback, ViewModel, console, screenshot, standalone-export, and media-export automation; legacy state-machine input controls and their two MCP tools were removed. The macOS app can deliberately claim `.riv` ownership and repair its document icon; Windows installers register the matching document icon. Anonymous Usage can be disabled in Settings; see the Privacy page for the exact disclosure.

Core pages:
- https://forge.mograph.life/apps/rav
- https://forge.mograph.life/apps/rav/docs
- https://forge.mograph.life/apps/rav/changelog
