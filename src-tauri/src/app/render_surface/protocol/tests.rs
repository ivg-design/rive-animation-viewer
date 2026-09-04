use super::{manager_authorizes_receipt, parse_bridge_probe, parse_startup_receipt};
use crate::app::render_surface::{geometry::RenderSurfaceBounds, registry::RenderSurfaceManager};
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
    assert!(manager_authorizes_receipt(
        &manager,
        "render-surface-candidate"
    ));

    let candidate = manager.pending_surface("candidate").unwrap().unwrap();
    assert!(manager.rollback_pending_surface(&candidate).unwrap());
    assert!(!manager_authorizes_receipt(
        &manager,
        "render-surface-candidate"
    ));

    manager
        .stage(
            "replacement".into(),
            "render-surface-replacement".into(),
            bounds,
        )
        .unwrap();
    let plan = manager.activation_plan("replacement").unwrap();
    manager.commit_activation(&plan).unwrap();
    assert!(manager_authorizes_receipt(
        &manager,
        "render-surface-replacement"
    ));
    assert!(!manager_authorizes_receipt(
        &manager,
        "render-surface-candidate"
    ));
}

#[test]
fn watchdog_retry_revokes_the_expired_child_label_before_recreation() {
    let manager = RenderSurfaceManager::default();
    let bounds = RenderSurfaceBounds::new(10.0, 20.0, 300.0, 200.0).unwrap();
    manager
        .stage(
            "candidate".into(),
            "render-surface-candidate".into(),
            bounds,
        )
        .unwrap();
    let ticket = manager.arm_activation_watchdog("candidate").unwrap();
    let retry = manager
        .begin_activation_watchdog_retry(
            &ticket,
            "render-surface-candidate-watchdog-retry-1".into(),
        )
        .unwrap()
        .unwrap();

    assert!(!manager_authorizes_receipt(&manager, &retry.expired.label));
    assert!(manager_authorizes_receipt(
        &manager,
        &retry.replacement.label
    ));
    assert_eq!(retry.replacement.activation_attempt, 1);
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
