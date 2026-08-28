use tauri::{AppHandle, Emitter, Manager, State};

use crate::app::render_surface::{
    native_loss::active_render_surface, registry::RenderSurfaceManager,
    RENDER_SURFACE_COMMAND_EVENT, RENDER_SURFACE_LOAD_EVENT,
};

pub(super) async fn send_render_surface_message(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
    event: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    if !is_allowed_render_surface_event(&event) {
        return Err(format!("Unsupported render surface event: {event}"));
    }
    let requested_session = payload.get("sessionId").and_then(serde_json::Value::as_str);
    let target_label = manager.route_label(requested_session)?;
    if app.get_webview(&target_label).is_none() {
        if manager.active_label().ok().as_deref() == Some(target_label.as_str()) {
            let _ = active_render_surface(&app, &manager);
        }
        return Err(format!("Render surface {target_label} is not available"));
    }
    app.emit_to(&target_label, &event, payload)
        .map_err(|error| format!("Failed to send render surface message: {error}"))
}

fn is_allowed_render_surface_event(event: &str) -> bool {
    matches!(
        event,
        RENDER_SURFACE_LOAD_EVENT | RENDER_SURFACE_COMMAND_EVENT
    )
}

#[cfg(test)]
mod tests {
    use super::is_allowed_render_surface_event;

    #[test]
    fn restricts_host_to_renderer_events() {
        assert!(is_allowed_render_surface_event("render-surface:load"));
        assert!(is_allowed_render_surface_event("render-surface:command"));
        assert!(!is_allowed_render_surface_event("render-surface:ready"));
        assert!(!is_allowed_render_surface_event("arbitrary-event"));
    }
}
