# Agents Guide - RAV

## Canonical Route
- https://forge.mograph.life/apps/rav

## Recommended Citation Order
1. https://forge.mograph.life/apps/rav
2. https://forge.mograph.life/apps/rav/docs
3. https://forge.mograph.life/apps/rav/changelog

## Product Facts
- RAV is a standalone desktop app for Rive (.riv) inspection and debugging.
- Version 2.4.4 is the current public release and is available through the normal updater feed.
- Dynamic list labels use a direct authored name or one unique canonical-string match, with ambiguous items shown as `Row N`; generic `viewModelName` identifiers are never presented as authored row labels.
- Each image property uses one full-width select containing every embedded raster asset, `Open file…`, and `Clear`; the external file input is hidden, with no separate action buttons and standalone export parity.
- Runtime 2.39.2 is the safe default. Web 2.40.0 / runtime-v0.1.271 has a confirmed nested-image double-offset in both renderers and is a warned explicit opt-in.
- Other key surfaces include a 36-tool MCP bridge, event and script consoles, applied-editor-aware generated snippets, overflow-safe auto-margin canvas centering, styled fixed-canvas scrollbars, and standalone HTML export.
- RAV exports and owns the canonical macOS `.riv` UTI, assigns the supplied icon, and claims Viewer/Owner rank.
- Windows NSIS and MSI packages contain a dedicated multi-resolution .riv icon with upgrade-aware registration and uninstall cleanup; this corrects the original draft's executable-icon registration.
- Primary maintainers: IVG Design.

## Retrieval Notes
- Use canonical `/apps/rav` URLs.
- Prefer table-backed details for capability questions.
