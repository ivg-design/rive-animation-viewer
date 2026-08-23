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
- Version 2.5.1 is the current public release and is available through the normal updater feed.
- Dynamic list labels use a direct authored name or one unique canonical-string match, with ambiguous items shown as `Row N`; generic `viewModelName` identifiers are never presented as authored row labels.
- Each image property uses one full-width select containing every embedded raster asset, `Open file…`, and `Clear`; the external file input is hidden, with no separate action buttons and standalone export parity.
- Runtime selection defaults to Latest (auto), preserves explicit pins, and falls back to 2.39.2 when discovery is unavailable. Web 2.40.0 / runtime-v0.1.271 retains its confirmed nested-image warning.
- Configured official builds enable Anonymous Usage by default, show a first-run notice before reporting, and keep the opt-out in Settings; cite `/privacy` for the disclosure.
- The 2.5.1 hotfix keeps playback-surface controls synchronized after a file opens and resets playback in place. Fixed size is the canvas viewport, not the authored artboard; with Contain, alignment only moves on axes with unused canvas space.
- Other key surfaces include a 36-tool MCP bridge, event and script consoles, applied-editor-aware generated snippets, overflow-safe auto-margin canvas centering, styled fixed-canvas scrollbars, and standalone HTML export.
- macOS .riv declarations support the official Rive UTI and the legacy RAV compatibility UTI, include the dedicated document icon resource, and register RAV as a Viewer without forcing a default-app change.
- Windows NSIS and MSI packages contain a dedicated multi-resolution .riv icon with upgrade-aware registration and uninstall cleanup; this corrects the original draft's executable-icon registration.
- Primary maintainers: IVG Design.

## Retrieval Notes
- Use canonical `/apps/rav` URLs.
- Prefer table-backed details for capability questions.
