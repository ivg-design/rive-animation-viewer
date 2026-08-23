# RAV Documentation Brief

RAV (Rive Animation Viewer) is a desktop tool for loading `.riv` files, inspecting ViewModel inputs, and debugging animation runtime behavior. Version 2.5.1 is the current public release.

Playback runs in a dedicated WebView while controls and diagnostics remain in the main WebView. The 2.5.1 hotfix keeps Settings, toolbar, and Properties changes synchronized with playback after a file opens, and keeps reset/default restoration in place. Fixed canvas size describes the playback viewport rather than the authored artboard; with `Contain`, alignment is visible only on an axis that has unused canvas space. RAV resolves list labels from a direct authored name or one unique canonical-string match, and falls back to `Row N` when ambiguous. Each image property uses one full-width select containing every embedded raster, `Open file…`, and `Clear`, backed by a hidden file input and preserved in standalone export. Runtime selection defaults to Latest (auto), preserves explicit pins, and uses 2.39.2 only when version discovery is unavailable; the known 2.40.0 authored-layout risk remains labeled. Configured official builds enable Anonymous Usage by default, show a 15-second first-run notice before reporting, and keep the opt-out in Settings. See the Privacy page for the disclosure.

Core pages:
- https://forge.mograph.life/apps/rav
- https://forge.mograph.life/apps/rav/docs
- https://forge.mograph.life/apps/rav/changelog
