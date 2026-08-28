use tauri::{AppHandle, Manager, State};

use crate::app::operational_trace::record;
use crate::app::render_surface::registry::{RenderSurfaceManager, SurfaceResource};

fn active_surface(manager: &State<'_, RenderSurfaceManager>) -> Result<SurfaceResource, String> {
    manager
        .active_surface()?
        .ok_or_else(|| "Render surface has not been created".to_string())
}

pub(crate) fn park_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
) -> Result<(), String> {
    let surface = active_surface(&manager)?;
    let webview = app
        .get_webview(&surface.label)
        .ok_or_else(|| format!("Active render surface {} is unavailable", surface.label))?;
    webview
        .set_bounds(surface.target_bounds.parked().rect())
        .map_err(|error| format!("Failed to park render surface: {error}"))?;
    // Showing the child while it is clipped offscreen guarantees WebKit keeps
    // advancing even if an earlier error path changed native visibility.
    webview
        .show()
        .map_err(|error| format!("Failed to keep parked render surface active: {error}"))?;
    record(
        &app,
        "render_surface.parked_for_overlay",
        serde_json::json!({ "compositorVisible": true }),
    );
    Ok(())
}

pub(crate) fn restore_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
) -> Result<(), String> {
    let surface = active_surface(&manager)?;
    let webview = app
        .get_webview(&surface.label)
        .ok_or_else(|| format!("Active render surface {} is unavailable", surface.label))?;
    webview
        .set_bounds(surface.target_bounds.rect())
        .map_err(|error| format!("Failed to restore render surface bounds: {error}"))?;
    webview
        .show()
        .map_err(|error| format!("Failed to show restored render surface: {error}"))?;
    record(
        &app,
        "render_surface.restored_after_overlay",
        serde_json::json!({ "visible": true }),
    );
    Ok(())
}
