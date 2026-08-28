use tauri::AppHandle;

use crate::app::operational_trace::record;

fn event_name(event: &str) -> String {
    format!("ui_overlay.{event}")
}

pub(super) fn purpose(app: &AppHandle, event: &str, purpose: &str) {
    record(
        app,
        &event_name(event),
        serde_json::json!({ "purpose": purpose }),
    );
}

pub(super) fn reason(app: &AppHandle, event: &str, reason: &str) {
    record(
        app,
        &event_name(event),
        serde_json::json!({ "reason": reason }),
    );
}

pub(super) fn scope(app: &AppHandle, event: &str, scope: &str) {
    record(
        app,
        &event_name(event),
        serde_json::json!({ "scope": scope }),
    );
}
