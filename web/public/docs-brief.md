# RAV Documentation Brief

RAV (Rive Animation Viewer) is a desktop tool for loading `.riv` files, inspecting ViewModel inputs, and debugging animation runtime behavior. Version 2.4.4 is the current public release.

The release isolates playback in a dedicated WebView while controls and diagnostics remain in the main WebView, resolves list labels from a direct authored name or one unique canonical-string match, and falls back to `Row N` when ambiguous. Each image property uses one full-width select containing every embedded raster, `Open file…`, and `Clear`, backed by a hidden file input and preserved in standalone export. Runtime 2.39.2 is the safe default because 2.40.0 has a confirmed nested-image double-offset in both Canvas and WebGL2. Configured official builds enable Anonymous Usage by default, show a 15-second first-run notice before reporting, and keep the opt-out in Settings. See the Privacy page for the disclosure.

Core pages:
- https://forge.mograph.life/apps/rav
- https://forge.mograph.life/apps/rav/docs
- https://forge.mograph.life/apps/rav/changelog
