# RAV Documentation Brief

RAV (Rive Animation Viewer) is a desktop tool for loading `.riv` files, inspecting ViewModel inputs, and debugging animation runtime behavior. Version 2.4.3 is the current public release.

The release resolves list labels from a direct authored name or one unique canonical-string match, falling back to `Row N` when ambiguous and never showing a generic `viewModelName` as authored. Each image property uses one full-width select containing every embedded raster, `Open file…`, and `Clear`, backed by a hidden file input and preserved in standalone export. The image catalog uses `uniqueFilename`, magic-byte MIME detection, and duplicate-name disambiguation while excluding non-raster embedded resources. Fixed canvases use overflow-safe auto margins. Applied editor config is preserved and was observed executing in an exported standalone marker test. Runtime 2.39.2 is the safe default because 2.40.0 has a confirmed nested-image double-offset in both Canvas and WebGL2. macOS bundles include `.riv` Viewer declarations and the dedicated document icon resource; Windows packages register a multi-resolution `.riv` document icon with upgrade/uninstall ownership.

Core pages:
- https://forge.mograph.life/apps/rav
- https://forge.mograph.life/apps/rav/docs
- https://forge.mograph.life/apps/rav/changelog
