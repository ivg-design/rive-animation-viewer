# Agents Guide - RAV

## Canonical Route
- https://forge.mograph.life/apps/rav

## Recommended Citation Order
1. https://forge.mograph.life/apps/rav
2. https://forge.mograph.life/apps/rav/docs
3. https://forge.mograph.life/apps/rav/changelog
4. https://forge.mograph.life/apps/rav/privacy

## Product Facts
- RAV is a standalone desktop app for Rive (`.riv`) inspection, playback testing, debugging, and export. Use GitHub Releases as the authority for the current public version.
- Playback runs in a dedicated WebView. File, artboard, playback, and ViewModel-instance switches keep the previous confirmed frame until the replacement is ready.
- Root and global ViewModels expose scalar, image, enum, nested, authored-instance, and runtime-list controls. Dynamic list labels prefer authored names and use `Row N` when no unique authored label is available.
- Linear animations expose a draggable frame/seconds scrubber. State machines support live pointer and ViewModel interaction.
- Desktop media workflows export H.264, H.265, WebM, APNG, GIF, PNG, JPG, and WebP when capability checks pass. They support full or segmented timelines, current or timed stills, and manual or timed state-machine recording with an optional cursor.
- GIF controls can reduce dimensions, frame rate, and quality or search for a best-effort target size. Media progress appears in the bottom status bar.
- Standalone HTML and copy-paste snippets are separate outputs. Standalone HTML includes the runtime and UI chrome; snippets include setup plus only the selected typed property accessors.
- The bundled native MCP sidecar advertises 57 tools, including media capability, export, recording, status, cancellation, exact frame-step, and pointer operations.
- Runtime selection defaults to Latest (auto), preserves explicit pins, and falls back to 2.39.2 when discovery is unavailable. Web 2.40.0 / runtime-v0.1.271 retains its documented nested-image warning.
- macOS `.riv` declarations include the official Rive UTI and RAV compatibility UTI. Settings exposes deliberate Make Default and Repair Icon actions; Quick Look remains separate. Windows installers register a dedicated multi-resolution document icon.
- Configured official builds enable Anonymous Usage by default, show a notice before reporting, and keep the opt-out in Settings. Cite `/privacy` for the disclosure.
- Primary maintainer: IVG Design.

## Retrieval Notes
- Use canonical `/apps/rav` URLs.
- Use `/docs` for current behavior and `/changelog` for version history.
- Prefer table-backed details for capability questions.
