use tauri::{webview::WebviewBuilder, AppHandle, Manager, State};

use crate::app::operational_trace::record;

use super::{
    activation::arm_activation_watchdog,
    commands::remove_surface_cache,
    geometry::RenderSurfaceBounds,
    registry::{RenderSurfaceManager, SurfaceResource},
    source::{
        normalize_session_id, render_surface_file_name, render_surface_label,
        resolve_render_surface_url, CreateRenderSurfaceRequest,
    },
    MAIN_WINDOW_LABEL,
};

fn trace(app: &AppHandle, event: &str, details: serde_json::Value) {
    record(app, event, details);
}

/// Creates a new opaque child WebView as an offscreen candidate. The existing
/// active surface remains authoritative until the normal activation commit.
pub(super) async fn create_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
    request: CreateRenderSurfaceRequest,
) -> Result<(), String> {
    let bounds = RenderSurfaceBounds::new(request.x, request.y, request.width, request.height)?;
    let replace_existing =
        request.url.is_some() || request.html_path.is_some() || request.payload.is_some();
    if !replace_existing {
        let active_label = manager.active_label()?;
        let webview = app
            .get_webview(&active_label)
            .ok_or_else(|| "Active render surface is not available".to_string())?;
        webview
            .set_bounds(bounds.rect())
            .map_err(|error| format!("Failed to resize render surface: {error}"))?;
        webview
            .show()
            .map_err(|error| format!("Failed to show render surface: {error}"))?;
        return Ok(());
    }

    let session_id = normalize_session_id(request.session_id.as_deref())?;
    let surface_label = render_surface_label(&session_id);
    let surface_file_name = render_surface_file_name(&session_id);

    if let Some(stale_webview) = app.get_webview(&surface_label) {
        if let Err(error) = stale_webview.close() {
            manager.record_retired(SurfaceResource {
                session_id: session_id.clone(),
                label: surface_label.clone(),
                target_bounds: bounds,
                activation_attempt: 0,
            })?;
            return Err(format!("Failed to replace stale render surface: {error}"));
        }
        // A stale native WebView can only be followed by a same-session file;
        // remove it before a new payload is written so an unsuccessful close
        // never makes us delete the new document later in this command.
        remove_surface_cache(&app, &manager, &session_id)?;
    }

    let webview_url = resolve_render_surface_url(
        &app,
        request.url.as_deref(),
        request.html_path.as_deref(),
        request.payload.as_ref(),
        &surface_file_name,
        Some(&session_id),
    )?;

    let main_window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main native window is not available".to_string())?;

    // WebviewAttributes defaults to transparent=false in Tauri 2.11.5. The
    // explicit `transparent(false)` builder method is unavailable on macOS
    // without the private-API feature, which this project intentionally avoids.
    let watchdog_url = webview_url.clone();
    let builder = WebviewBuilder::new(&surface_label, webview_url).focused(false);

    // Stage offscreen rather than hidden: the native view stays compositor
    // visible so Rive and requestAnimationFrame can paint, while clipping
    // prevents it from covering the active playback surface.
    let staged_bounds = bounds.staged();
    // Register before `add_child`: a fast local document can emit its ready
    // beacon as soon as the native child starts navigating. That first beacon
    // must be routable to this candidate rather than rejected as unknown.
    let candidate = SurfaceResource {
        session_id,
        label: surface_label,
        target_bounds: bounds,
        activation_attempt: 0,
    };
    manager.stage(
        candidate.session_id.clone(),
        candidate.label.clone(),
        candidate.target_bounds,
    )?;

    let webview =
        match main_window.add_child(builder, staged_bounds.position(), staged_bounds.size()) {
            Ok(webview) => webview,
            Err(error) => {
                trace(
                    &app,
                    "render_surface.stage_failed",
                    serde_json::json!({ "reason": "native_child_create" }),
                );
                return Err(rollback_failed_staged_surface(
                    &app,
                    &manager,
                    &candidate,
                    format!("Failed to create render surface: {error}"),
                ));
            }
        };
    if let Err(error) = webview.show() {
        trace(
            &app,
            "render_surface.stage_failed",
            serde_json::json!({ "reason": "native_child_show" }),
        );
        return Err(rollback_failed_staged_surface(
            &app,
            &manager,
            &candidate,
            format!("Failed to show staged render surface: {error}"),
        ));
    }

    if let Err(error) = arm_activation_watchdog(&app, &manager, &candidate.session_id, watchdog_url)
    {
        trace(
            &app,
            "render_surface.stage_failed",
            serde_json::json!({ "reason": "activation_watchdog_arm" }),
        );
        return Err(rollback_failed_staged_surface(
            &app,
            &manager,
            &candidate,
            format!("Failed to arm render-surface activation watchdog: {error}"),
        ));
    }

    Ok(())
}

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
