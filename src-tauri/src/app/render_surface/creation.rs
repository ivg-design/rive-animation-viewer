use tauri::{AppHandle, Manager};

use super::{
    commands::remove_surface_cache,
    registry::{RenderSurfaceManager, SurfaceResource},
};

/// Unwinds a candidate creation without disturbing the currently active
/// surface. The candidate is first made unroutable, then its child is closed.
/// If native close itself fails, retain it as retired so normal lifecycle
/// cleanup can retry it rather than leaking an untracked child/cache pair.
pub(super) fn rollback_failed_staged_surface(
    app: &AppHandle,
    manager: &RenderSurfaceManager,
    candidate: &SurfaceResource,
    failure: String,
) -> String {
    let mut details = vec![failure];
    match manager.rollback_pending_surface(candidate) {
        Ok(true) => {}
        Ok(false) => details.push(format!(
            "staged render surface {} changed before rollback",
            candidate.label
        )),
        Err(error) => details.push(format!(
            "failed to roll back staged registry entry: {error}"
        )),
    }

    if let Some(webview) = app.get_webview(&candidate.label) {
        if let Err(error) = webview.close() {
            match manager.record_retired(candidate.clone()) {
                Ok(()) => details.push(format!(
                    "failed to close rolled-back render surface {} (retained for cleanup): {error}",
                    candidate.label
                )),
                Err(registry_error) => details.push(format!(
                    "failed to close rolled-back render surface {}: {error}; failed to retain it for cleanup: {registry_error}",
                    candidate.label
                )),
            }
            return details.join("; ");
        }
    }

    if let Err(error) = remove_surface_cache(app, manager, &candidate.session_id) {
        details.push(format!(
            "failed to remove rolled-back render surface cache: {error}"
        ));
    }
    details.join("; ")
}
