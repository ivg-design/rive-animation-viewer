use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use tauri::{
    http::{header, Request, Response, StatusCode},
    Emitter, Manager, Runtime, UriSchemeContext,
};

use super::{
    registry::RenderSurfaceManager, source::render_surface_file_name, MAIN_WINDOW_LABEL,
    RENDER_SURFACE_BRIDGE_PROBE_PATH, RENDER_SURFACE_DIRECTORY, RENDER_SURFACE_LABEL_PREFIX,
    RENDER_SURFACE_STARTUP_RECEIPT_PATH,
};

/// Serves only the generated, cache-local standalone HTML to the child WebView.
/// A registered custom protocol is treated as a local Tauri origin, so the
/// event bridge remains available without granting arbitrary remote IPC.
pub fn serve_render_surface_protocol<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let Some(session_id) = context
        .webview_label()
        .strip_prefix(RENDER_SURFACE_LABEL_PREFIX)
    else {
        return protocol_error(StatusCode::NOT_FOUND, "Render surface resource not found");
    };
    if request.uri().path() == RENDER_SURFACE_BRIDGE_PROBE_PATH {
        return serve_bridge_probe(&context, session_id, request.uri().query());
    }
    if request.uri().path() == RENDER_SURFACE_STARTUP_RECEIPT_PATH {
        return serve_startup_receipt(&context, session_id, request.uri().query());
    }
    let expected_file_name = render_surface_file_name(session_id);
    let requested_file_name = request.uri().path().trim_start_matches('/');
    if requested_file_name != expected_file_name {
        return protocol_error(StatusCode::NOT_FOUND, "Render surface resource not found");
    }

    let html_path = match context.app_handle().path().app_cache_dir() {
        Ok(cache_dir) => cache_dir
            .join(RENDER_SURFACE_DIRECTORY)
            .join(&expected_file_name),
        Err(error) => {
            return protocol_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to resolve RAV cache directory: {error}"),
            )
        }
    };

    match std::fs::read(&html_path) {
        Ok(html) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-store")
            .body(html)
            .expect("valid render surface response"),
        Err(error) => protocol_error(
            StatusCode::NOT_FOUND,
            &format!("Failed to read render surface HTML: {error}"),
        ),
    }
}

fn serve_startup_receipt<R: Runtime>(
    context: &UriSchemeContext<'_, R>,
    session_id: &str,
    query: Option<&str>,
) -> Response<Vec<u8>> {
    if !receipt_session_is_authorized(context.app_handle(), session_id) {
        return protocol_error(
            StatusCode::GONE,
            "Render surface session is no longer active",
        );
    }
    let Some((event_name, payload)) = parse_startup_receipt(session_id, query) else {
        return protocol_error(
            StatusCode::BAD_REQUEST,
            "Invalid render surface startup receipt",
        );
    };
    let _ = context
        .app_handle()
        .emit_to(MAIN_WINDOW_LABEL, event_name, payload);
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .expect("valid render surface startup receipt response")
}

fn parse_startup_receipt(
    session_id: &str,
    query: Option<&str>,
) -> Option<(&'static str, serde_json::Value)> {
    let fields: std::collections::BTreeMap<_, _> = query
        .unwrap_or_default()
        .split('&')
        .filter_map(|part| part.split_once('='))
        .filter(|(key, value)| matches!(*key, "event" | "payload") && value.len() <= 4096)
        .collect();
    let startup_event = *fields.get("event")?;
    let encoded = fields.get("payload")?;
    let decoded = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    if decoded.len() > 3072 {
        return None;
    }
    let supplied: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    let object = supplied.as_object()?;
    let mut payload = serde_json::Map::new();
    payload.insert("sessionId".into(), session_id.into());
    payload.insert("transport".into(), "custom-protocol".into());

    let event_name = match startup_event {
        "ready" => {
            let attempt = object.get("attempt")?.as_i64()?;
            if !(-1..=64).contains(&attempt) {
                return None;
            }
            let handshake = object.get("handshake")?.as_str()?;
            if !matches!(handshake, "acknowledged" | "pending") {
                return None;
            }
            let protocol = object
                .get("protocolVersion")
                .or_else(|| object.get("protocol"))?
                .as_u64()?;
            if !(1..=2).contains(&protocol) {
                return None;
            }
            payload.insert("attempt".into(), attempt.into());
            payload.insert("handshake".into(), handshake.into());
            payload.insert("protocol".into(), protocol.into());
            payload.insert("protocolVersion".into(), protocol.into());
            if let Some(reason) = bounded_string(object.get("reason"), 32) {
                payload.insert("reason".into(), reason.into());
            }
            "render-surface:ready"
        }
        "loaded" => {
            if object
                .get("firstFrame")
                .and_then(serde_json::Value::as_bool)
                != Some(true)
            {
                return None;
            }
            payload.insert("firstFrame".into(), true.into());
            payload.insert("protocolVersion".into(), 2.into());
            if let Some(binding) = sanitize_binding(object.get("binding")) {
                payload.insert("binding".into(), binding);
            }
            for key in ["fileName", "runtimeName", "runtimeVersion"] {
                if let Some(value) = bounded_string(object.get(key), 256) {
                    payload.insert(key.into(), value.into());
                }
            }
            "render-surface:loaded"
        }
        "error" => {
            let phase = object.get("phase")?.as_str()?;
            if !matches!(phase, "listen" | "load" | "load-listen")
                || object
                    .get("recoverable")
                    .and_then(serde_json::Value::as_bool)
                    == Some(true)
            {
                return None;
            }
            let message = bounded_string(object.get("message"), 512)?;
            payload.insert("message".into(), message.into());
            payload.insert("phase".into(), phase.into());
            "render-surface:error"
        }
        _ => return None,
    };
    Some((event_name, serde_json::Value::Object(payload)))
}

fn bounded_string(value: Option<&serde_json::Value>, max_len: usize) -> Option<&str> {
    value?.as_str().filter(|value| value.len() <= max_len)
}

fn sanitize_binding(value: Option<&serde_json::Value>) -> Option<serde_json::Value> {
    let binding = value?.as_object()?;
    let requested = binding.get("requested")?.as_bool()?;
    let applied = binding.get("applied")?.as_bool()?;
    let key = binding
        .get("key")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    if !matches!(
        key,
        serde_json::Value::Null | serde_json::Value::String(_) | serde_json::Value::Number(_)
    ) || key.as_str().is_some_and(|value| value.len() > 256)
    {
        return None;
    }
    Some(serde_json::json!({ "applied": applied, "key": key, "requested": requested }))
}

/// Receives a deliberately tiny, same-origin startup receipt from the child.
/// This is not a generic message channel: it only reports whether the injected
/// Tauri event facade was present, so the parent can distinguish a missing
/// child IPC facade from a lost or rejected event handshake.
fn serve_bridge_probe<R: Runtime>(
    context: &UriSchemeContext<'_, R>,
    session_id: &str,
    query: Option<&str>,
) -> Response<Vec<u8>> {
    if !receipt_session_is_authorized(context.app_handle(), session_id) {
        return protocol_error(
            StatusCode::GONE,
            "Render surface session is no longer active",
        );
    }
    let fields = parse_bridge_probe(query);
    let phase = fields.get("phase").map(String::as_str).unwrap_or("unknown");
    let mut payload = serde_json::json!({
        "sessionId": session_id,
        "source": "custom-protocol",
        "phase": phase,
        "eventApi": {
            "available": fields.get("available").map(String::as_str) == Some("1"),
            "listen": fields.get("listen").map(String::as_str) == Some("1"),
            "emitTo": fields.get("emitTo").map(String::as_str) == Some("1"),
            "emit": fields.get("emit").map(String::as_str) == Some("1"),
        },
    });
    if let Some(detail) = fields.get("detail").filter(|value| value.len() <= 160) {
        payload["detail"] = detail.clone().into();
    }
    let _ = context
        .app_handle()
        .emit_to(MAIN_WINDOW_LABEL, "render-surface:diagnostic", payload);
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .expect("valid render surface bridge probe response")
}

fn receipt_session_is_authorized<R: Runtime>(app: &tauri::AppHandle<R>, session_id: &str) -> bool {
    app.try_state::<RenderSurfaceManager>()
        .is_some_and(|manager| manager_authorizes_receipt(&manager, session_id))
}

fn manager_authorizes_receipt(manager: &RenderSurfaceManager, session_id: &str) -> bool {
    manager.route_label(Some(session_id)).is_ok()
}

fn parse_bridge_probe(query: Option<&str>) -> std::collections::BTreeMap<String, String> {
    query
        .unwrap_or_default()
        .split('&')
        .filter_map(|part| part.split_once('='))
        .filter(|(key, value)| {
            matches!(
                *key,
                "phase" | "detail" | "available" | "listen" | "emitTo" | "emit"
            ) && value.len() <= if *key == "detail" { 160 } else { 40 }
                && value.is_ascii()
        })
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
}

fn protocol_error(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(message.as_bytes().to_vec())
        .expect("valid render surface error response")
}

#[cfg(test)]
mod tests {
    use super::{manager_authorizes_receipt, parse_bridge_probe, parse_startup_receipt};
    use crate::app::render_surface::{
        geometry::RenderSurfaceBounds, registry::RenderSurfaceManager,
    };
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    #[test]
    fn bridge_probe_accepts_only_small_expected_diagnostic_fields() {
        let fields = parse_bridge_probe(Some(
            "phase=boot&available=1&listen=1&emitTo=0&emit=1&detail=decoder-stalled&ignored=secret&phase=last",
        ));
        assert_eq!(fields.get("phase"), Some(&"last".to_string()));
        assert_eq!(fields.get("available"), Some(&"1".to_string()));
        assert_eq!(fields.get("detail"), Some(&"decoder-stalled".to_string()));
        assert!(!fields.contains_key("ignored"));
    }

    #[test]
    fn startup_receipts_are_authorized_only_for_pending_or_active_sessions() {
        let manager = RenderSurfaceManager::default();
        let bounds = RenderSurfaceBounds::new(10.0, 20.0, 300.0, 200.0).unwrap();
        manager
            .stage(
                "candidate".into(),
                "render-surface-candidate".into(),
                bounds,
            )
            .unwrap();
        assert!(manager_authorizes_receipt(&manager, "candidate"));

        let candidate = manager.pending_surface("candidate").unwrap().unwrap();
        assert!(manager.rollback_pending_surface(&candidate).unwrap());
        assert!(!manager_authorizes_receipt(&manager, "candidate"));

        manager
            .stage(
                "replacement".into(),
                "render-surface-replacement".into(),
                bounds,
            )
            .unwrap();
        let plan = manager.activation_plan("replacement").unwrap();
        manager.commit_activation(&plan).unwrap();
        assert!(manager_authorizes_receipt(&manager, "replacement"));
        assert!(!manager_authorizes_receipt(&manager, "candidate"));
    }

    #[test]
    fn startup_receipt_allows_only_bounded_critical_events() {
        let encoded = URL_SAFE_NO_PAD.encode(
            br#"{"attempt":2,"handshake":"pending","protocolVersion":2,"reason":"retry","sessionId":"forged"}"#,
        );
        let query = format!("event=ready&payload={encoded}");
        let (event, payload) = parse_startup_receipt("native-session", Some(&query)).unwrap();
        assert_eq!(event, "render-surface:ready");
        assert_eq!(payload["sessionId"], "native-session");
        assert_eq!(payload["attempt"], 2);
        assert_eq!(payload["transport"], "custom-protocol");

        let encoded = URL_SAFE_NO_PAD.encode(br#"{"commandId":"x"}"#);
        assert!(parse_startup_receipt(
            "native-session",
            Some(&format!("event=ack&payload={encoded}"))
        )
        .is_none());
    }

    #[test]
    fn first_frame_receipt_preserves_binding_and_rejects_pre_frame_loaded() {
        let encoded = URL_SAFE_NO_PAD.encode(
            br#"{"binding":{"applied":false,"key":"Board","requested":true},"firstFrame":true,"protocolVersion":2}"#,
        );
        let (event, payload) = parse_startup_receipt(
            "loaded-session",
            Some(&format!("event=loaded&payload={encoded}")),
        )
        .unwrap();
        assert_eq!(event, "render-surface:loaded");
        assert_eq!(payload["binding"]["key"], "Board");
        assert_eq!(payload["firstFrame"], true);

        let encoded = URL_SAFE_NO_PAD.encode(br#"{"firstFrame":false}"#);
        assert!(parse_startup_receipt(
            "loaded-session",
            Some(&format!("event=loaded&payload={encoded}")),
        )
        .is_none());
    }
}
