# RAV Documentation Brief

RAV (Rive Animation Viewer) is a desktop tool for loading `.riv` files, inspecting ViewModel inputs, and debugging animation runtime behavior. Version 2.5.2 is a release candidate and is not yet publicly available.

Playback runs in a dedicated WebView while controls and diagnostics remain in the main WebView. Version 2.5.2 keeps the last confirmed frame visible while files, artboards, playback targets, or ViewModel instances change, discards stale rapid-switch work, and queues warm file opens. Timeline playback shows current and total frames or seconds. Scalars, booleans, images, authored instances, and runtime-generated list instances stay synchronized with the visible surface; both reset paths restore playback and controls together. Fixed canvas size describes the playback viewport rather than the authored artboard; with `Contain`, alignment is visible only on an axis that has unused canvas space. Runtime selection defaults to Latest (auto), preserves explicit pins, and uses 2.39.2 only when version discovery is unavailable; the known 2.40.0 authored-layout risk remains labeled. Configured official builds enable Anonymous Usage by default, show a 15-second first-run notice before reporting, and keep the opt-out in Settings. Turning it off sends one final anonymous off status and then stops reporting. See the Privacy page for the disclosure.

Core pages:
- https://forge.mograph.life/apps/rav
- https://forge.mograph.life/apps/rav/docs
- https://forge.mograph.life/apps/rav/changelog
