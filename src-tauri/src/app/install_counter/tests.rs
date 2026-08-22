use std::{
    fs,
    time::{Duration, UNIX_EPOCH},
};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::Value;

use super::protocol::hmac_sha256;
use super::*;

#[test]
fn enablement_creates_random_state_and_opt_out_removes_linkable_values_without_losing_deduplication(
) {
    let mut state = CounterState::default();
    apply_enabled(&mut state, true);
    assert!(state.enabled);
    assert_eq!(state.pending_install_token.as_ref().unwrap().len(), 22);
    assert_eq!(state.activity_secret.as_ref().unwrap().len(), 43);

    state.install_reported = true;
    state.last_active_period = Some("2026-08".to_string());
    apply_enabled(&mut state, false);
    assert!(!state.enabled);
    assert!(state.install_reported);
    assert!(state.pending_install_token.is_none());
    assert!(state.activity_secret.is_none());
    assert_eq!(state.last_active_period.as_deref(), Some("2026-08"));

    apply_enabled(&mut state, true);
    assert!(state.enabled);
    assert!(state.pending_install_token.is_none());
    assert!(state.activity_secret.is_some());
    assert_eq!(state.last_active_period.as_deref(), Some("2026-08"));
}

#[test]
fn monthly_tokens_are_stable_within_a_month_and_rotate_between_months() {
    let secret = URL_SAFE_NO_PAD.encode([7_u8; 32]);
    let august = monthly_token(&secret, "2026-08").unwrap();
    assert_eq!(august, monthly_token(&secret, "2026-08").unwrap());
    assert_ne!(august, monthly_token(&secret, "2026-09").unwrap());
}

#[test]
fn hmac_matches_the_rfc_4231_sha256_vector() {
    let digest = hmac_sha256(&[0x0b; 20], b"Hi There");
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    assert_eq!(
        hex,
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
    );
}

#[test]
fn payload_contains_only_the_public_counter_schema() {
    let payload = CounterPayload {
        schema: 1,
        event: "monthly_active",
        token: "opaque".to_string(),
        release: "2.4.4".to_string(),
        period: Some("2026-08".to_string()),
    };
    let value = serde_json::to_value(payload).unwrap();
    let Value::Object(fields) = value else {
        panic!("counter payload must be an object");
    };
    assert_eq!(
        fields.keys().cloned().collect::<Vec<_>>(),
        vec!["event", "period", "release", "schema", "token"]
    );
}

#[test]
fn utc_month_uses_calendar_month_boundaries() {
    assert_eq!(utc_month(UNIX_EPOCH), "1970-01");
    assert_eq!(
        utc_month(UNIX_EPOCH + Duration::from_secs(1_787_875_200)),
        "2026-08"
    );
}

#[test]
fn endpoint_requires_https_and_the_fixed_event_path() {
    assert!(validate_endpoint("https://counter.example/v1/event").is_ok());
    assert!(validate_endpoint("http://counter.example/v1/event").is_err());
    assert!(validate_endpoint("https://counter.example/v1/event?token=no").is_err());
    assert!(validate_endpoint("https://counter.example/anything-else").is_err());
}

#[test]
fn counter_client_installs_its_tls_provider_before_construction() {
    build_counter_client().expect("counter client must build without relying on updater startup");
}

#[test]
fn successful_in_flight_reports_keep_only_deduplication_after_opt_out() {
    let now = UNIX_EPOCH + Duration::from_secs(1_787_875_200);
    let mut state = CounterState::default();
    apply_enabled(&mut state, true);
    apply_enabled(&mut state, false);

    record_install_success(&mut state, now);
    record_monthly_active_success(&mut state, "2026-08".to_string(), now);

    assert!(!state.enabled);
    assert!(state.install_reported);
    assert!(state.pending_install_token.is_none());
    assert!(state.activity_secret.is_none());
    assert_eq!(state.last_active_period.as_deref(), Some("2026-08"));

    apply_enabled(&mut state, true);
    assert!(state.pending_install_token.is_none());
    assert!(state.activity_secret.is_some());
    assert_eq!(state.last_active_period.as_deref(), Some("2026-08"));
}

#[test]
fn first_run_defaults_on_but_reports_only_after_the_notice_is_recorded() {
    let mut state = CounterState::default();
    apply_enabled(&mut state, true);

    assert!(state.enabled);
    assert_eq!(state.notice_version, 0);
    assert!(status_from_state(&state).notice_required);
    assert!(!reporting_is_ready(&state));

    state.notice_version = NOTICE_VERSION;
    assert!(!status_from_state(&state).notice_required);
    assert!(reporting_is_ready(&state));

    apply_enabled(&mut state, false);
    assert!(!reporting_is_ready(&state));
}

#[test]
fn corrupt_existing_state_fails_closed_instead_of_reenabling_counting() {
    let directory = std::env::temp_dir().join(format!(
        "rav-counter-corrupt-state-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join(state::COUNTER_STATE_FILE);
    fs::write(&path, b"not valid json").unwrap();

    let state = ensure_state(&path, true).unwrap();
    assert!(!state.enabled);
    assert_eq!(state.notice_version, NOTICE_VERSION);
    assert!(!status_from_state(&state).notice_required);
    assert!(!reporting_is_ready(&state));

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn legacy_opt_out_deserializes_as_disabled() {
    let state: CounterState = serde_json::from_value(serde_json::json!({
        "consent": false,
        "installReported": false
    }))
    .unwrap();
    assert!(!state.enabled);
    assert!(!reporting_is_ready(&state));
}

#[test]
fn durable_opt_out_marker_prevents_default_reenable_if_state_file_is_lost() {
    let directory = std::env::temp_dir().join(format!(
        "rav-counter-disabled-marker-{}",
        uuid::Uuid::new_v4()
    ));
    let path = directory.join(state::COUNTER_STATE_FILE);
    let mut counter_state = ensure_state(&path, true).unwrap();
    apply_enabled(&mut counter_state, false);
    counter_state.notice_version = NOTICE_VERSION;
    write_state(&path, &counter_state).unwrap();

    let marker = state::disabled_marker_path(&path);
    assert!(marker.is_file());
    fs::remove_file(&path).unwrap();

    let restored = ensure_state(&path, true).unwrap();
    assert!(!restored.enabled);
    assert_eq!(restored.notice_version, NOTICE_VERSION);
    assert!(!reporting_is_ready(&restored));

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn explicit_reenable_clears_the_durable_opt_out_marker() {
    let directory = std::env::temp_dir().join(format!(
        "rav-counter-reenable-marker-{}",
        uuid::Uuid::new_v4()
    ));
    let path = directory.join(state::COUNTER_STATE_FILE);
    let mut counter_state = ensure_state(&path, false).unwrap();
    assert!(state::disabled_marker_path(&path).is_file());

    apply_enabled(&mut counter_state, true);
    counter_state.notice_version = NOTICE_VERSION;
    write_state(&path, &counter_state).unwrap();

    assert!(!state::disabled_marker_path(&path).exists());
    assert!(read_state(&path).enabled);

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn live_reads_honor_the_opt_out_marker_when_json_still_says_enabled() {
    let directory =
        std::env::temp_dir().join(format!("rav-counter-live-marker-{}", uuid::Uuid::new_v4()));
    let path = directory.join(state::COUNTER_STATE_FILE);
    let mut counter_state = ensure_state(&path, true).unwrap();
    apply_enabled(&mut counter_state, false);
    write_state(&path, &counter_state).unwrap();

    apply_enabled(&mut counter_state, true);
    fs::write(&path, serde_json::to_vec(&counter_state).unwrap()).unwrap();

    let guarded = read_state(&path);
    assert!(!guarded.enabled);
    assert!(guarded.pending_install_token.is_none());
    assert!(guarded.activity_secret.is_none());
    assert!(!reporting_is_ready(&guarded));

    fs::remove_dir_all(directory).unwrap();
}
