use std::time::Duration;

use tauri::{webview::WebviewBuilder, AppHandle, Emitter, Manager, WebviewUrl};

use crate::app::operational_trace::record;

use super::super::{
    creation::rollback_failed_staged_surface,
    registry::{ActivationWatchdogRetry, ActivationWatchdogTicket, RenderSurfaceManager},
    source::render_surface_retry_label,
    MAIN_WINDOW_LABEL,
};

pub(super) const ACTIVATION_WATCHDOG_DEADLINE: Duration = Duration::from_secs(15);
const NATIVE_CLOSE_DEADLINE: Duration = Duration::from_secs(1);
const NATIVE_CLOSE_POLL_INTERVAL: Duration = Duration::from_millis(25);
const WATCHDOG_EVENT: &str = "render-surface:activation-watchdog";

pub(in crate::app::render_surface) fn arm_activation_watchdog(
    app: &AppHandle,
    manager: &RenderSurfaceManager,
    session_id: &str,
    webview_url: WebviewUrl,
) -> Result<(), String> {
    let ticket = manager.arm_activation_watchdog(session_id)?;
    record(
        app,
        "render_surface.activation_watchdog_armed",
        serde_json::json!({
            "deadlineMs": ACTIVATION_WATCHDOG_DEADLINE.as_millis(),
            "generation": ticket.generation,
            "retryLimit": 1,
            "sessionId": ticket.session_id,
        }),
    );
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(ACTIVATION_WATCHDOG_DEADLINE).await;
        recover_once(app, ticket, webview_url).await;
    });
    Ok(())
}

async fn recover_once(app: AppHandle, ticket: ActivationWatchdogTicket, webview_url: WebviewUrl) {
    let manager = app.state::<RenderSurfaceManager>();
    let replacement_label = render_surface_retry_label(&ticket.session_id, ticket.generation);
    let retry = match manager.begin_activation_watchdog_retry(&ticket, replacement_label) {
        Ok(Some(retry)) => retry,
        Ok(None) => return,
        Err(error) => {
            watchdog_failure(&app, &ticket.session_id, 0, "registry-claim", error);
            return;
        }
    };

    record(
        &app,
        "render_surface.activation_watchdog_deadline",
        serde_json::json!({
            "activationAttempt": retry.expired.activation_attempt,
            "deadlineMs": ACTIVATION_WATCHDOG_DEADLINE.as_millis(),
            "generation": ticket.generation,
            "sessionId": ticket.session_id,
        }),
    );
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        WATCHDOG_EVENT,
        serde_json::json!({
            "activationAttempt": retry.replacement.activation_attempt,
            "deadlineMs": ACTIVATION_WATCHDOG_DEADLINE.as_millis(),
            "phase": "retry-started",
            "retry": 1,
            "retryLimit": 1,
            "sessionId": ticket.session_id,
        }),
    );
    record(
        &app,
        "render_surface.activation_watchdog_retry_started",
        serde_json::json!({
            "activationAttempt": retry.replacement.activation_attempt,
            "generation": ticket.generation,
            "retry": 1,
            "retryLimit": 1,
            "sessionId": ticket.session_id,
        }),
    );

    if let Some(expired) = app.get_webview(&retry.expired.label) {
        if let Err(error) = expired.close() {
            let _ = manager.record_retired(retry.expired.clone());
            fail_retry(
                &app,
                &manager,
                &retry,
                "native-child-close",
                format!("Failed to destroy timed-out render surface: {error}"),
            );
            return;
        }
        if !wait_until_webview_removed(&app, &retry.expired.label).await {
            let _ = manager.record_retired(retry.expired.clone());
            fail_retry(
                &app,
                &manager,
                &retry,
                "native-child-close-deadline",
                "Timed-out render surface did not close before the native recovery deadline."
                    .to_string(),
            );
            return;
        }
    }

    let Some(main_window) = app.get_window(MAIN_WINDOW_LABEL) else {
        fail_retry(
            &app,
            &manager,
            &retry,
            "main-window-missing",
            "Main native window is unavailable during render-surface recovery.".to_string(),
        );
        return;
    };
    let staged_bounds = retry.replacement.target_bounds.staged();
    let builder = WebviewBuilder::new(&retry.replacement.label, webview_url).focused(false);
    let webview =
        match main_window.add_child(builder, staged_bounds.position(), staged_bounds.size()) {
            Ok(webview) => webview,
            Err(error) => {
                fail_retry(
                    &app,
                    &manager,
                    &retry,
                    "native-child-create",
                    format!("Failed to recreate timed-out render surface: {error}"),
                );
                return;
            }
        };
    if let Err(error) = webview.show() {
        fail_retry(
            &app,
            &manager,
            &retry,
            "native-child-show",
            format!("Failed to show recovered render surface: {error}"),
        );
        return;
    }

    record(
        &app,
        "render_surface.activation_watchdog_retry_created",
        serde_json::json!({
            "activationAttempt": retry.replacement.activation_attempt,
            "generation": ticket.generation,
            "retry": 1,
            "retryLimit": 1,
            "sessionId": ticket.session_id,
        }),
    );
}

async fn wait_until_webview_removed(app: &AppHandle, label: &str) -> bool {
    let deadline = tokio::time::Instant::now() + NATIVE_CLOSE_DEADLINE;
    loop {
        if app.get_webview(label).is_none() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(NATIVE_CLOSE_POLL_INTERVAL).await;
    }
}

fn fail_retry(
    app: &AppHandle,
    manager: &RenderSurfaceManager,
    retry: &ActivationWatchdogRetry,
    stage: &str,
    failure: String,
) {
    let message = rollback_failed_staged_surface(app, manager, &retry.replacement, failure);
    watchdog_failure(
        app,
        &retry.replacement.session_id,
        retry.replacement.activation_attempt,
        stage,
        message,
    );
}

fn watchdog_failure(
    app: &AppHandle,
    session_id: &str,
    activation_attempt: u8,
    stage: &str,
    message: String,
) {
    eprintln!("[rav-app] Render-surface activation watchdog failed at {stage}: {message}");
    record(
        app,
        "render_surface.activation_watchdog_retry_failed",
        serde_json::json!({
            "activationAttempt": activation_attempt,
            "message": message,
            "retry": 1,
            "retryLimit": 1,
            "sessionId": session_id,
            "stage": stage,
        }),
    );
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        "render-surface:error",
        serde_json::json!({
            "activationAttempt": activation_attempt,
            "message": "The playback renderer did not recover after one native restart.",
            "phase": "activation-watchdog",
            "recoverable": false,
            "sessionId": session_id,
        }),
    );
}
