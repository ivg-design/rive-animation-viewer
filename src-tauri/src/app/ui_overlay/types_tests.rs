use super::{
    ShowUiOverlayRequest, UiOverlayActionCompletionRequest, UiOverlayActionRequest,
    UiOverlayBounds, UI_OVERLAY_MAX_ACTION_MESSAGE_BYTES,
};

#[test]
fn media_export_intents_are_allowlisted_and_keep_typed_bounded_fields() {
    let mut action = UiOverlayActionRequest {
        epoch: 1,
        action_id: "media-1".into(),
        purpose: "export".into(),
        action: "media-select".into(),
        value: serde_json::json!("still"),
    };
    assert!(action.validate().is_ok());
    for name in [
        "media-menu",
        "media-html",
        "media-submit",
        "media-stop",
        "media-cancel",
        "media-choose-path",
        "media-toggle-recording",
    ] {
        action.action = name.into();
        action.value = serde_json::Value::Null;
        assert!(action.validate().is_ok(), "{name}");
    }
    action.action = "media-change".into();
    for value in [
        serde_json::json!({"name":"width","value":"640"}),
        serde_json::json!({"name":"alpha","value":true}),
        serde_json::json!({"name":"output_path","value":""}),
    ] {
        action.value = value;
        assert!(action.validate().is_ok());
    }
    for value in [
        serde_json::json!({"name":"arbitrary_command","value":"x"}),
        serde_json::json!({"name":"alpha","value":"true"}),
        serde_json::json!({"name":"width","value":[]}),
        serde_json::json!({"name":"fps","value":"30","extra":true}),
    ] {
        action.value = value;
        assert!(action.validate().is_err());
    }
}

#[test]
fn validates_bounded_allowlisted_overlay_requests() {
    let request = ShowUiOverlayRequest {
        purpose: "settings".into(),
        bounds: UiOverlayBounds {
            x: 10.0,
            y: 20.0,
            width: 520.0,
            height: 310.0,
        },
        request_token: "M9E1PYZC0HcUtxhqX-eoC3m8Wz4wD7vB".into(),
        state: serde_json::json!({ "enabled": true }),
        focus: true,
    };
    assert!(request.validate().is_ok());
}

#[test]
fn rejects_unknown_purposes_and_invalid_geometry() {
    let request = ShowUiOverlayRequest {
        purpose: "arbitrary-html".into(),
        bounds: UiOverlayBounds {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 20.0,
        },
        request_token: "M9E1PYZC0HcUtxhqX-eoC3m8Wz4wD7vB".into(),
        state: serde_json::json!({}),
        focus: false,
    };
    assert!(request.validate().is_err());
}

#[test]
fn rejects_short_or_unsafe_request_tokens() {
    let request = ShowUiOverlayRequest {
        purpose: "settings".into(),
        bounds: UiOverlayBounds {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        },
        request_token: "not safe!".into(),
        state: serde_json::json!({}),
        focus: false,
    };
    assert!(request.validate().is_err());
}

#[test]
fn action_contract_is_allowlisted_and_bounded() {
    let action = UiOverlayActionRequest {
        epoch: 4,
        action_id: "export-selection-1".into(),
        purpose: "export".into(),
        action: "selection-toggle".into(),
        value: serde_json::json!({ "key": "TrackMapVM/driver", "selected": true }),
    };
    assert!(action.validate().is_ok());
    let rejected = UiOverlayActionRequest {
        action: "invoke-anything".into(),
        ..action
    };
    assert!(rejected.validate().is_err());
}

#[test]
fn rejects_wrong_typed_or_whole_selection_overlay_actions() {
    let wrong_type = UiOverlayActionRequest {
        epoch: 4,
        action_id: "export-selection-2".into(),
        purpose: "export".into(),
        action: "selection-toggle".into(),
        value: serde_json::json!({ "key": ["TrackMapVM/driver"], "selected": true }),
    };
    assert!(wrong_type.validate().is_err());

    let obsolete_whole_selection = UiOverlayActionRequest {
        action: "selection-replace".into(),
        value: serde_json::json!(["TrackMapVM/driver"]),
        ..wrong_type
    };
    assert!(obsolete_whole_selection.validate().is_err());
}

#[test]
fn validates_numeric_and_enum_action_values() {
    let canvas_width = UiOverlayActionRequest {
        epoch: 2,
        action_id: "settings-width-1".into(),
        purpose: "settings".into(),
        action: "canvas-width".into(),
        value: serde_json::json!("8192"),
    };
    assert!(canvas_width.validate().is_ok());
    assert!(UiOverlayActionRequest {
        value: serde_json::json!("8193"),
        ..canvas_width.clone()
    }
    .validate()
    .is_err());
    assert!(UiOverlayActionRequest {
        action: "canvas-mode".into(),
        value: serde_json::json!("fixed"),
        ..canvas_width
    }
    .validate()
    .is_ok());
}

#[test]
fn action_receipts_require_bounded_safe_identity_and_message() {
    let completion = UiOverlayActionCompletionRequest {
        epoch: 4,
        action_id: "export-selection-1".into(),
        ok: true,
        message: String::new(),
    };
    assert!(completion.validate().is_ok());
    assert!(UiOverlayActionCompletionRequest {
        action_id: "not safe!".into(),
        ..completion.clone()
    }
    .validate()
    .is_err());
    assert!(UiOverlayActionCompletionRequest {
        message: "x".repeat(UI_OVERLAY_MAX_ACTION_MESSAGE_BYTES + 1),
        ..completion
    }
    .validate()
    .is_err());
}
