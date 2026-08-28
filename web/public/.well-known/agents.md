# Agents Guide - RAV

## Canonical Route
- https://forge.mograph.life/apps/rav

## Recommended Citation Order
1. https://forge.mograph.life/apps/rav
2. https://forge.mograph.life/apps/rav/docs
3. https://forge.mograph.life/apps/rav/changelog
4. https://forge.mograph.life/apps/rav/privacy

## Product Facts
- RAV is a standalone desktop app for Rive (.riv) inspection and debugging.
- Version 2.5.2 is a release candidate and is not yet available through the public updater feed.
- Dynamic list labels use a direct authored name or one unique canonical-string match, with ambiguous items shown as `Row N`; generic `viewModelName` identifiers are never presented as authored row labels.
- Each image property uses one full-width select containing every embedded raster asset, `Open file…`, and `Clear`; the external file input is hidden, with no separate action buttons and standalone export parity.
- Runtime selection defaults to Latest (auto), preserves explicit pins, and falls back to 2.39.2 when discovery is unavailable. Web 2.40.0 / runtime-v0.1.271 retains its confirmed nested-image warning.
- Configured official builds enable Anonymous Usage by default, show a first-run notice before reporting, and keep the opt-out in Settings; cite `/privacy` for the disclosure.
- The 2.5.2 reliability update keeps the last confirmed frame visible while files, artboards, playback targets, and ViewModel instances change; stale rapid-switch work is discarded. Timeline playback adds a frames/seconds progress meter, warm opens are queued, and scalar, image, and runtime-list controls stay synchronized with the visible playback surface.
- Other key surfaces include a 36-tool MCP bridge, event and script consoles, applied-editor-aware generated snippets, overflow-safe auto-margin canvas centering, styled fixed-canvas scrollbars, and standalone HTML export.
- macOS .riv declarations support the official Rive UTI and the legacy RAV compatibility UTI, include the dedicated document icon resource, and register RAV as a Viewer without forcing a default-app change. Settings names the resolved handler and exposes deliberate Make Default and Repair Icon actions; Quick Look remains separate.
- Windows NSIS and MSI packages contain a dedicated multi-resolution .riv icon with upgrade-aware registration and uninstall cleanup; this corrects the original draft's executable-icon registration.
- Primary maintainers: IVG Design.

## Retrieval Notes
- Use canonical `/apps/rav` URLs.
- Prefer table-backed details for capability questions.
