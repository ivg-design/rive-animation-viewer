use tauri::{AppHandle, Emitter, Manager, Runtime, State, Webview};

use super::{
    commands::remove_surface_cache,
    registry::{RenderSurfaceManager, SurfaceResource},
    MAIN_WINDOW_LABEL,
};
use crate::app::operational_trace::record;

// Dispatch cleanup before the native close on the same WebView queue. The
// pagehide/beforeunload hooks in the child provide the teardown fallback when
// script evaluation is unavailable during a partial load.
const DISPOSE_RENDER_SURFACE_SCRIPT: &str =
    "(function(){try{return typeof window.__ravDisposeRenderSurface==='function'&&window.__ravDisposeRenderSurface()===true;}catch(_error){return false;}})();";

pub(super) fn dispose_and_close<R: Runtime>(webview: &Webview<R>) -> tauri::Result<()> {
    // Cleanup is best effort: a candidate may fail before its application
    // script installs the hook, but native retirement must still proceed.
    let _ = webview.eval(DISPOSE_RENDER_SURFACE_SCRIPT);
    webview.close()
}

pub(super) async fn dispose_and_close_confirmed<R: Runtime>(
    webview: &Webview<R>,
) -> Result<bool, tauri::Error> {
    let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
    let dispatched = webview.eval_with_callback(DISPOSE_RENDER_SURFACE_SCRIPT, move |result| {
        let _ = sender.try_send(result == "true");
    });
    let confirmed = if dispatched.is_ok() {
        tokio::time::timeout(std::time::Duration::from_millis(500), receiver.recv())
            .await
            .ok()
            .flatten()
            .unwrap_or(false)
    } else {
        false
    };
    webview.close()?;
    Ok(confirmed)
}

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

#[cfg(test)]
mod retirement_tests {
    use super::DISPOSE_RENDER_SURFACE_SCRIPT;

    #[test]
    fn disposal_script_is_guarded_for_partially_loaded_children() {
        assert!(DISPOSE_RENDER_SURFACE_SCRIPT.contains("typeof window.__ravDisposeRenderSurface"));
        assert!(DISPOSE_RENDER_SURFACE_SCRIPT.contains("__ravDisposeRenderSurface()===true"));
    }
}
