use tauri::{AppHandle, Manager, State};

use super::{manager::UiOverlayManager, trace, types::UiOverlayBounds};

pub(super) fn set_ui_overlay_bounds(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    epoch: u64,
    bounds: UiOverlayBounds,
) -> Result<(), String> {
    let bounds = bounds.validate()?;
    let active = manager
        .active()?
        .filter(|resource| resource.epoch == epoch)
        .ok_or_else(|| "UI overlay epoch is stale".to_string())?;
    let webview = app
        .get_webview(&active.label)
        .ok_or_else(|| "Active UI overlay WebView is unavailable".to_string())?;
    webview
        .set_bounds(bounds.rect())
        .map_err(|error| format!("Failed to resize UI overlay: {error}"))?;
    manager
        .update_active_bounds(epoch, bounds)?
        .ok_or_else(|| "UI overlay epoch changed while resizing".to_string())?;
    trace::purpose(&app, "resized", &active.request.purpose);
    Ok(())
}
