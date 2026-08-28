use tauri::{AppHandle, Emitter, Manager, State};

use super::{
    commands::remove_surface_cache,
    registry::{RenderSurfaceManager, SurfaceResource},
    MAIN_WINDOW_LABEL,
};
use crate::app::operational_trace::record;

pub(super) fn active_render_surface(
    app: &AppHandle,
    manager: &State<'_, RenderSurfaceManager>,
) -> Result<tauri::Webview, String> {
    let surface = manager
        .active_surface()?
        .ok_or_else(|| "Render surface has not been activated".to_string())?;
    if let Some(webview) = app.get_webview(&surface.label) {
        return Ok(webview);
    }
    handle_missing_active_surface(
        manager,
        &surface,
        |session_id| remove_surface_cache(app, manager, session_id),
        |payload| {
            app.emit_to(MAIN_WINDOW_LABEL, "render-surface:error", payload)
                .map_err(|error| format!("Failed to report native render surface loss: {error}"))
        },
    );
    record(
        app,
        "render_surface.native_loss",
        serde_json::json!({ "recoverable": false }),
    );
    Err("Active render surface is not available".to_string())
}

pub(super) fn handle_missing_active_surface<Cleanup, Emit>(
    manager: &RenderSurfaceManager,
    surface: &SurfaceResource,
    cleanup: Cleanup,
    emit: Emit,
) where
    Cleanup: FnOnce(&str) -> Result<(), String>,
    Emit: FnOnce(serde_json::Value) -> Result<(), String>,
{
    // Release native authority first so a second command cannot keep routing
    // into a child that no longer exists. Pending replacements are keyed by a
    // different label/session and remain available for recovery.
    let _ = manager.release_surface(surface);
    let _ = cleanup(&surface.session_id);
    let _ = emit(serde_json::json!({
        "message": "Native playback surface became unavailable",
        "phase": "native-loss",
        "recoverable": false,
        "sessionId": surface.session_id,
    }));
}
