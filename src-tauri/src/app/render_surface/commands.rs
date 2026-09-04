use tauri::{AppHandle, Manager, State};

use crate::app::operational_trace::record;

use super::{
    activation::{converge_committed_bounds, prepare_staged_surface_for_activation},
    geometry::RenderSurfaceBounds,
    native_loss::active_render_surface,
    registry::RenderSurfaceManager,
    source::{
        cleanup_stale_render_surface_cache, normalize_session_id, remove_render_surface_cache_file,
        CreateRenderSurfaceRequest,
    },
};

fn trace(app: &AppHandle, event: &str, details: serde_json::Value) {
    record(app, event, details);
}

/// Creates the opaque child WebView, or updates and shows the existing child.
/// Coordinates and dimensions are logical pixels relative to the main native
/// window's content area.
pub(super) async fn create_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
    request: CreateRenderSurfaceRequest,
) -> Result<(), String> {
    retry_pending_cache_cleanup(&app, &manager);
    super::creation::create_render_surface(app, manager, request).await
}

pub(super) fn set_render_surface_bounds(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let bounds = RenderSurfaceBounds::new(x, y, width, height)?;
    let surfaces = manager.apply_bounds(bounds)?;
    if surfaces.is_empty() {
        return Err("Render surface has not been created".to_string());
    }
    for surface in surfaces {
        if let Some(webview) = app.get_webview(&surface.resource.label) {
            let applied_bounds = if surface.staged {
                surface.resource.target_bounds.staged()
            } else {
                surface.resource.target_bounds
            };
            webview.set_bounds(applied_bounds.rect()).map_err(|error| {
                format!(
                    "Failed to resize render surface {}: {error}",
                    surface.resource.label
                )
            })?;
        }
    }
    Ok(())
}

pub(super) fn show_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
) -> Result<(), String> {
    active_render_surface(&app, &manager)?
        .show()
        .map_err(|error| format!("Failed to show render surface: {error}"))
}

pub(super) fn hide_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
) -> Result<(), String> {
    active_render_surface(&app, &manager)?
        .hide()
        .map_err(|error| format!("Failed to hide render surface: {error}"))
}

pub(super) fn close_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
) -> Result<(), String> {
    close_all_render_surfaces(&app, &manager)
}

pub(crate) fn close_all_render_surfaces(
    app: &AppHandle,
    manager: &RenderSurfaceManager,
) -> Result<(), String> {
    let mut failures = Vec::new();
    for surface in manager.managed_surfaces()? {
        if let Err(error) = retire_surface(app, manager, &surface) {
            failures.push(error);
        }
    }
    retry_pending_cache_cleanup_collect(app, manager, &mut failures);
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Failed to close one or more render surfaces: {}",
            failures.join("; ")
        ))
    }
}

pub(super) fn activate_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
    session_id: String,
    reveal: bool,
) -> Result<(), String> {
    let session_id = normalize_session_id(Some(&session_id))?;
    let plan = manager.activation_plan(&session_id)?;
    let replaces_active = plan.previous.is_some();
    trace(
        &app,
        "render_surface.activation_requested",
        serde_json::json!({
            "reveal": reveal, "replacesActive": replaces_active
        }),
    );

    let Some(next) = app.get_webview(&plan.next.label) else {
        trace(
            &app,
            "render_surface.activation_failed",
            serde_json::json!({ "stage": "staged_child_missing" }),
        );
        return Err(format!(
            "Staged render surface {} is unavailable",
            plan.next.label
        ));
    };
    // Move the fully painted staged child into its requested geometry before
    // retiring the prior surface. This ordering keeps the anti-flicker fence.
    if let Err(error) = prepare_staged_surface_for_activation(
        reveal,
        || {
            next.set_bounds(plan.next.target_bounds.rect())
                .map_err(|error| error.to_string())
        },
        || next.show().map_err(|error| error.to_string()),
        || next.hide().map_err(|error| error.to_string()),
    ) {
        trace(
            &app,
            "render_surface.activation_failed",
            serde_json::json!({ "stage": "native_presentation" }),
        );
        return Err(error);
    }

    let activated = match manager.commit_activation(&plan) {
        Ok(surface) => surface,
        Err(error) => {
            let _ = next.set_bounds(plan.next.target_bounds.staged().rect());
            trace(
                &app,
                "render_surface.activation_failed",
                serde_json::json!({ "stage": "registry_commit" }),
            );
            return Err(error);
        }
    };

    // A resize may have updated the pending geometry after the initial
    // onscreen move. Apply that latest snapshot before retiring the old
    // surface; otherwise the new active child can briefly use stale bounds.
    converge_committed_bounds(&activated, &plan.next, |bounds| {
        next.set_bounds(bounds.rect())
            .map_err(|error| format!("Failed to apply updated render surface bounds: {error}"))
    });

    if let Some(previous) = plan
        .previous
        .as_ref()
        .filter(|surface| *surface != &plan.next)
    {
        if let Some(previous_webview) = app.get_webview(&previous.label) {
            let _ = previous_webview.hide();
        }
        // The activation commit atomically moved this predecessor into the
        // retired registry. A close/cache failure therefore stays discoverable
        // for shutdown cleanup and must not invalidate the new authority.
        if let Err(error) = retire_surface(&app, &manager, previous) {
            eprintln!("[rav-app] Render surface activated; deferred predecessor cleanup: {error}");
            trace(
                &app,
                "render_surface.predecessor_cleanup_deferred",
                serde_json::json!({ "deferred": true }),
            );
        }
    }
    if activated.activation_attempt > 0 {
        trace(
            &app,
            "render_surface.activation_watchdog_retry_succeeded",
            serde_json::json!({
                "activationAttempt": activated.activation_attempt,
                "retry": 1,
                "retryLimit": 1,
                "sessionId": activated.session_id.as_str(),
            }),
        );
    }
    trace(
        &app,
        "render_surface.activated",
        serde_json::json!({
            "activationAttempt": activated.activation_attempt,
            "reveal": reveal,
            "replacedActive": replaces_active,
            "sessionId": activated.session_id.as_str(),
        }),
    );
    Ok(())
}

pub(super) fn discard_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
    session_id: String,
) -> Result<(), String> {
    let session_id = normalize_session_id(Some(&session_id))?;
    if let Some(surface) = manager.pending_surface(&session_id)? {
        retire_surface(&app, &manager, &surface)?;
    }
    retry_pending_cache_cleanup(&app, &manager);
    Ok(())
}

/// Called during setup before any child WebView can exist. A failed delete is
/// retained by the registry and retried by every lifecycle command and close.
pub(crate) fn cleanup_render_surface_cache_on_startup(
    app: &AppHandle,
    manager: &RenderSurfaceManager,
) -> Result<(), String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to resolve RAV cache directory: {error}"))?;
    for (session_id, error) in cleanup_stale_render_surface_cache(&cache_dir) {
        if !session_id.is_empty() {
            manager.record_cache_retry(session_id)?;
        }
        eprintln!("[rav-app] {error}");
    }
    Ok(())
}

fn retire_surface(
    app: &AppHandle,
    manager: &RenderSurfaceManager,
    surface: &super::registry::SurfaceResource,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&surface.label) {
        webview.close().map_err(|error| {
            format!("Failed to close render surface {}: {error}", surface.label)
        })?;
    }
    remove_surface_cache(app, manager, &surface.session_id)?;
    manager.release_surface(surface)
}

pub(super) fn remove_surface_cache(
    app: &AppHandle,
    manager: &RenderSurfaceManager,
    session_id: &str,
) -> Result<(), String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to resolve RAV cache directory: {error}"))?;
    match remove_render_surface_cache_file(&cache_dir, session_id) {
        Ok(()) => manager.release_cache_retry(session_id),
        Err(error) => {
            manager.record_cache_retry(session_id.to_string())?;
            Err(error)
        }
    }
}

fn retry_pending_cache_cleanup(app: &AppHandle, manager: &RenderSurfaceManager) {
    let mut ignored = Vec::new();
    retry_pending_cache_cleanup_collect(app, manager, &mut ignored);
}

fn retry_pending_cache_cleanup_collect(
    app: &AppHandle,
    manager: &RenderSurfaceManager,
    failures: &mut Vec<String>,
) {
    let Ok(session_ids) = manager.cache_retry_sessions() else {
        return;
    };
    for session_id in session_ids {
        if let Err(error) = remove_surface_cache(app, manager, &session_id) {
            failures.push(error);
        }
    }
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;
