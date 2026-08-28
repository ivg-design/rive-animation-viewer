use std::time::Duration;
use tauri::{webview::WebviewBuilder, AppHandle, Emitter, Manager, State, WebviewUrl};
use tokio::{sync::oneshot, time::timeout};

use super::{
    manager::UiOverlayManager,
    trace,
    types::{
        ShowUiOverlayRequest, UiOverlayActionCompletionRequest, UiOverlayActionRequest,
        UiOverlayReadyRequest, UI_OVERLAY_MAX_STATE_BYTES,
    },
};

const MAIN_WINDOW_LABEL: &str = "main";
const UI_OVERLAY_DOCUMENT: &str = "overlay.html";
const UI_OVERLAY_READY_TIMEOUT: Duration = Duration::from_secs(6);

fn emit_overlay_failure(
    app: &AppHandle,
    epoch: u64,
    request_token: &str,
    message: impl Into<String>,
) {
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        "ui-overlay:error",
        serde_json::json!({ "epoch": epoch, "requestToken": request_token, "message": message.into() }),
    );
}

fn prepare_ready_overlay(
    webview: tauri::Webview,
    request: UiOverlayReadyRequest,
) -> Result<(), String> {
    let app = webview.app_handle().clone();
    let manager = app.state::<UiOverlayManager>();
    let label = webview.label().to_string();
    let pending = manager
        .prepare_pending(&label, request.epoch, &request.purpose)?
        .ok_or_else(|| {
            "UI overlay ready signal was stale, duplicated, or unauthorized".to_string()
        })?;
    trace::purpose(&app, "prepared", &pending.request.purpose);
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        "ui-overlay:prepared",
        serde_json::json!({
            "epoch": pending.epoch,
            "purpose": pending.request.purpose,
            "requestToken": pending.request.request_token,
            "protocolVersion": 1,
        }),
    );
    Ok(())
}

fn start_overlay(
    app: &AppHandle,
    manager: &UiOverlayManager,
    request: ShowUiOverlayRequest,
) -> Result<
    (
        super::types::UiOverlayResource,
        oneshot::Receiver<Result<(), String>>,
    ),
    String,
> {
    let _ = retry_retiring_ui_overlays(app, manager);
    let request = request.validate()?;
    let (resource, ready) = manager.stage(request)?;
    trace::purpose(app, "stage_requested", &resource.request.purpose);
    let bootstrap = match serde_json::to_string(&resource.bootstrap()) {
        Ok(bootstrap) => bootstrap,
        Err(error) => {
            let _ = manager.reject_pending(&resource.label);
            let _ = retry_retiring_ui_overlays(app, manager);
            return Err(format!("Failed to serialize UI overlay bootstrap: {error}"));
        }
    };
    let init_script = format!("window.__RAV_UI_OVERLAY_BOOTSTRAP__ = Object.freeze({bootstrap});");
    let builder = WebviewBuilder::new(&resource.label, WebviewUrl::App(UI_OVERLAY_DOCUMENT.into()))
        .focused(false)
        .initialization_script(init_script);
    let main_window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main native window is not available".to_string())?;
    let staged = resource.request.bounds.staged();
    if let Err(error) = main_window.add_child(builder, staged.position(), staged.size()) {
        let _ = manager.reject_pending(&resource.label);
        let _ = retry_retiring_ui_overlays(app, manager);
        trace::reason(app, "stage_failed", "native_child_create");
        return Err(format!("Failed to create UI overlay: {error}"));
    }
    trace::purpose(app, "staged", &resource.request.purpose);
    Ok((resource, ready))
}

pub(super) async fn show_ui_overlay(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    request: ShowUiOverlayRequest,
) -> Result<u64, String> {
    let (resource, ready) = start_overlay(&app, &manager, request)?;
    await_overlay_adoption(
        &app,
        &manager,
        resource.epoch,
        resource.epoch,
        &resource.request.request_token,
        ready,
        "UI overlay did not become ready",
    )
    .await?;
    Ok(resource.epoch)
}

pub(super) async fn restack_ui_overlay(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
) -> Result<Option<u64>, String> {
    let Some(active) = manager
        .wait_for_active_or_pending_resolution(UI_OVERLAY_READY_TIMEOUT)
        .await?
    else {
        return Ok(None);
    };
    let fallback_epoch = active.epoch;
    let request_token = active.request.request_token.clone();
    let (resource, ready) = match start_overlay(&app, &manager, active.request) {
        Ok(started) => started,
        Err(message) => {
            let _ = app.emit_to(
                MAIN_WINDOW_LABEL,
                "ui-overlay:restack-error",
                serde_json::json!({ "epoch": fallback_epoch, "requestToken": request_token, "message": message }),
            );
            return Err(message);
        }
    };
    await_overlay_adoption(
        &app,
        &manager,
        resource.epoch,
        fallback_epoch,
        &resource.request.request_token,
        ready,
        "UI overlay did not become ready before playback activation",
    )
    .await
    .map(|_| Some(resource.epoch))
}

async fn await_overlay_adoption(
    app: &AppHandle,
    manager: &UiOverlayManager,
    epoch: u64,
    fallback_epoch: u64,
    request_token: &str,
    ready: oneshot::Receiver<Result<(), String>>,
    timeout_message: &str,
) -> Result<(), String> {
    match timeout(UI_OVERLAY_READY_TIMEOUT, ready).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(message))) => {
            let _ = manager.reject_pending_epoch(epoch)?;
            let _ = retry_retiring_ui_overlays(app, manager);
            let _ = app.emit_to(
                MAIN_WINDOW_LABEL,
                "ui-overlay:restack-error",
                serde_json::json!({ "epoch": fallback_epoch, "requestToken": request_token, "message": message }),
            );
            trace::reason(app, "adoption_failed", "ready_rejected");
            Err(message)
        }
        Ok(Err(_)) => {
            let message = "UI overlay readiness channel closed".to_string();
            let _ = app.emit_to(
                MAIN_WINDOW_LABEL,
                "ui-overlay:restack-error",
                serde_json::json!({ "epoch": fallback_epoch, "requestToken": request_token, "message": message }),
            );
            trace::reason(app, "adoption_failed", "ready_channel_closed");
            Err(message)
        }
        Err(_) => {
            let message = timeout_message.to_string();
            let _ = manager.reject_pending_epoch(epoch)?;
            let _ = retry_retiring_ui_overlays(app, manager);
            let _ = app.emit_to(
                MAIN_WINDOW_LABEL,
                "ui-overlay:restack-error",
                serde_json::json!({ "epoch": fallback_epoch, "requestToken": request_token, "message": message }),
            );
            trace::reason(app, "adoption_failed", "ready_timeout");
            Err(message)
        }
    }
}

pub(super) fn acknowledge_ui_overlay_adopted(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    epoch: u64,
) -> Result<(), String> {
    let label = format!("ui-overlay-{epoch}");
    let pending = manager
        .prepared_pending(&label)?
        .ok_or_else(|| "UI overlay epoch is stale, unprepared, or already adopted".to_string())?;
    let Some(webview) = app.get_webview(&pending.label) else {
        let _ = manager.reject_pending(&pending.label);
        let _ = retry_retiring_ui_overlays(&app, &manager);
        let message = "Prepared UI overlay WebView is no longer available".to_string();
        emit_overlay_failure(
            &app,
            pending.epoch,
            &pending.request.request_token,
            message.clone(),
        );
        return Err(message);
    };
    if let Err(error) = webview.set_bounds(pending.request.bounds.rect()) {
        let _ = manager.reject_pending(&pending.label);
        let _ = retry_retiring_ui_overlays(&app, &manager);
        let message = format!("Failed to position UI overlay: {error}");
        emit_overlay_failure(
            &app,
            pending.epoch,
            &pending.request.request_token,
            message.clone(),
        );
        trace::reason(&app, "adoption_failed", "native_position");
        return Err(message);
    }
    if let Err(error) = webview.show() {
        let _ = manager.reject_pending(&pending.label);
        let _ = retry_retiring_ui_overlays(&app, &manager);
        let message = format!("Failed to show UI overlay: {error}");
        emit_overlay_failure(
            &app,
            pending.epoch,
            &pending.request.request_token,
            message.clone(),
        );
        trace::reason(&app, "adoption_failed", "native_show");
        return Err(message);
    }
    let Some(active) = manager.acknowledge_adoption(&pending.label)? else {
        // Bounds/show ran outside the registry lock. If another close or
        // replacement won that interval, retire this now-visible candidate
        // and immediately attempt its native close instead of leaving it
        // orphaned on screen.
        let _ = manager.retire_failed_adoption(&pending.label)?;
        let _ = retry_retiring_ui_overlays(&app, &manager);
        return Err("UI overlay epoch is stale or already adopted".to_string());
    };
    let _ = retry_retiring_ui_overlays(&app, &manager);
    let _ = app.emit_to(
        &active.label,
        "ui-overlay:presented",
        serde_json::json!({ "epoch": active.epoch }),
    );
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        "ui-overlay:opened",
        serde_json::json!({
            "epoch": active.epoch,
            "purpose": active.request.purpose,
            "requestToken": active.request.request_token,
            "protocolVersion": 1,
        }),
    );
    trace::purpose(&app, "adopted", &active.request.purpose);
    Ok(())
}

pub(super) fn ui_overlay_ready(
    webview: tauri::Webview,
    request: UiOverlayReadyRequest,
) -> Result<(), String> {
    prepare_ready_overlay(webview, request)
}

pub(super) fn submit_ui_overlay_action(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    webview: tauri::Webview,
    request: UiOverlayActionRequest,
) -> Result<(), String> {
    request.validate()?;
    let active = manager
        .authorized_action_source(
            request.epoch,
            &request.purpose,
            webview.label(),
            &request.action,
        )?
        .ok_or_else(|| {
            "UI overlay action was submitted by a stale or unauthorized overlay".to_string()
        })?;
    app.emit_to(
        MAIN_WINDOW_LABEL,
        "ui-overlay:action",
        serde_json::json!({
            "epoch": request.epoch,
            "actionId": request.action_id,
            "purpose": request.purpose,
            "requestToken": active.request.request_token,
            "action": request.action,
            "value": request.value,
        }),
    )
    .map_err(|error| format!("Failed to forward UI overlay action: {error}"))
}

pub(super) fn complete_ui_overlay_action(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    webview: tauri::Webview,
    request: UiOverlayActionCompletionRequest,
) -> Result<(), String> {
    request.validate()?;
    if webview.label() != MAIN_WINDOW_LABEL {
        return Err(
            "UI overlay action results may only be submitted by the main WebView".to_string(),
        );
    }
    let active = manager
        .active()?
        .ok_or_else(|| "No adopted UI overlay is active".to_string())?;
    if active.epoch != request.epoch {
        return Err("UI overlay action result was submitted for a stale overlay".to_string());
    }
    app.emit_to(
        &active.label,
        "ui-overlay:action-result",
        serde_json::json!({
            "epoch": request.epoch,
            "actionId": request.action_id,
            "ok": request.ok,
            "message": request.message,
        }),
    )
    .map_err(|error| format!("Failed to emit UI overlay action result: {error}"))
}

pub(super) fn update_ui_overlay_state(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    epoch: u64,
    state: serde_json::Value,
) -> Result<(), String> {
    if !state.is_object() {
        return Err("UI overlay state must be an object".to_string());
    }
    if serde_json::to_vec(&state)
        .map_err(|error| error.to_string())?
        .len()
        > UI_OVERLAY_MAX_STATE_BYTES
    {
        return Err("UI overlay state exceeds the bounded payload size".to_string());
    }
    let active = manager
        .update_active_state(epoch, state.clone())?
        .ok_or_else(|| "UI overlay epoch is stale".to_string())?;
    app.emit_to(
        &active.label,
        "ui-overlay:state",
        serde_json::json!({ "epoch": epoch, "state": state }),
    )
    .map_err(|error| format!("Failed to update UI overlay: {error}"))
}

pub(super) fn close_ui_overlay(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    expected_epoch: Option<u64>,
) -> Result<(), String> {
    close_ui_overlays(&app, &manager, expected_epoch)
}

fn close_ui_overlays(
    app: &AppHandle,
    manager: &UiOverlayManager,
    expected_epoch: Option<u64>,
) -> Result<(), String> {
    manager.retire_for_close(expected_epoch)?;
    let failures = retry_retiring_ui_overlays(app, manager)?;
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.set_focus();
    }
    if failures.is_empty() {
        trace::scope(app, "retired", "requested");
        Ok(())
    } else {
        trace::scope(app, "retirement_deferred", "requested");
        Err(format!(
            "Failed to close UI overlay: {}",
            failures.join("; ")
        ))
    }
}

pub(crate) fn close_all_ui_overlays(
    app: &AppHandle,
    manager: &UiOverlayManager,
) -> Result<(), String> {
    manager.retire_all()?;
    let failures = retry_retiring_ui_overlays(app, manager)?;
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.set_focus();
    }
    if failures.is_empty() {
        trace::scope(app, "retired", "application_exit");
        Ok(())
    } else {
        trace::scope(app, "retirement_deferred", "application_exit");
        Err(format!(
            "Failed to close UI overlay: {}",
            failures.join("; ")
        ))
    }
}

/// Attempts every retired child but keeps failed closes registered for a later
/// safe retry. A missing child is already closed from the app's perspective.
fn retry_retiring_ui_overlays(
    app: &AppHandle,
    manager: &UiOverlayManager,
) -> Result<Vec<String>, String> {
    let mut failures = Vec::new();
    for overlay in manager.retiring()? {
        if let Some(webview) = app.get_webview(&overlay.label) {
            if let Err(error) = webview.close() {
                failures.push(format!("{}: {error}", overlay.label));
                continue;
            }
        }
        manager.mark_retired_closed(&overlay.label)?;
    }
    Ok(failures)
}
