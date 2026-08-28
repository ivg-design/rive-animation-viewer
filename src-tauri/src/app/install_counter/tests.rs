use std::time::{Duration, UNIX_EPOCH};

use serde_json::Value;

use super::protocol::hmac_sha256;
use super::*;

mod persistence;
mod telemetry;

#[test]
fn enablement_creates_a_stable_install_identifier_and_opt_out_removes_future_reporting_values() {
    let mut state = CounterState::default();
    apply_enabled(&mut state, true);
    assert!(state.enabled);
    assert_eq!(state.preference_generation, 1);
    assert_eq!(state.install_token.as_ref().unwrap().len(), 22);
    assert_eq!(state.pending_install_token.as_ref().unwrap().len(), 22);
    assert!(state.activity_secret.is_none());
    let install_token = state.install_token.clone().unwrap();

    state.install_reported = true;
    state.last_active_period = Some("2026-08".to_string());
    apply_enabled(&mut state, false);
    assert!(!state.enabled);
    assert_eq!(state.preference_generation, 2);
    assert!(state.install_reported);
    assert_eq!(state.install_token.as_deref(), Some(install_token.as_str()));
    assert!(state.pending_install_token.is_none());
    assert!(state.activity_secret.is_none());
    assert_eq!(state.last_active_period.as_deref(), Some("2026-08"));

    apply_enabled(&mut state, true);
    assert!(state.enabled);
    assert_eq!(state.preference_generation, 3);
    assert_eq!(
        state.pending_install_token.as_deref(),
        Some(install_token.as_str())
    );
    assert!(state.install_reported);
    assert!(state.activity_secret.is_none());
    assert_eq!(state.last_active_period.as_deref(), Some("2026-08"));
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
        schema: 2,
        event: "monthly_active",
        token: "opaque".to_string(),
        release: "2.5.0".to_string(),
        preference_generation: 7,
        period: Some("2026-08".to_string()),
        status: None,
        establish_install: None,
    };
    let value = serde_json::to_value(payload).unwrap();
    let Value::Object(fields) = value else {
        panic!("counter payload must be an object");
    };
    assert_eq!(
        fields.keys().cloned().collect::<Vec<_>>(),
        vec![
            "event",
            "period",
            "preferenceGeneration",
            "release",
            "schema",
            "token"
        ]
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
fn telemetry_acceptance_is_release_only_and_does_not_enable_official_builds() {
    assert!(telemetry_acceptance_enabled_from_values(
        false,
        None,
        Some("1")
    ));
    assert!(!telemetry_acceptance_enabled_from_values(
        true,
        None,
        Some("1")
    ));
    assert!(!telemetry_acceptance_enabled_from_values(
        false,
        Some("1"),
        Some("1")
    ));
    assert!(!telemetry_acceptance_enabled_from_values(false, None, None));
}

#[test]
fn telemetry_acceptance_requires_its_own_app_identity() {
    assert!(telemetry_acceptance_identifier_is_valid(
        true,
        TELEMETRY_ACCEPTANCE_IDENTIFIER
    ));
    assert!(!telemetry_acceptance_identifier_is_valid(
        true,
        "app.rive.animation.viewer.flicker-test"
    ));
    assert!(!telemetry_acceptance_identifier_is_valid(
        true,
        "app.rive.animation.viewer"
    ));
    assert!(telemetry_acceptance_identifier_is_valid(
        false,
        "app.rive.animation.viewer"
    ));
}

#[test]
fn endpoint_selection_keeps_normal_dev_and_official_builds_separate_from_acceptance() {
    let acceptance = "https://acceptance.example/v1/event";
    let official = "https://official.example/v1/event";
    assert_eq!(
        configured_endpoint_from_values(false, None, None, Some("1"), Some(acceptance))
            .unwrap()
            .as_str(),
        acceptance
    );
    assert!(configured_endpoint_from_values(false, None, None, None, Some(acceptance)).is_none());
    assert_eq!(
        configured_endpoint_from_values(
            false,
            Some("1"),
            Some(official),
            Some("1"),
            Some(acceptance)
        )
        .unwrap()
        .as_str(),
        official
    );
    assert!(
        configured_endpoint_from_values(true, None, None, Some("1"), Some(acceptance)).is_none()
    );
}

#[test]
fn counter_client_installs_its_tls_provider_before_construction() {
    build_counter_client().expect("counter client must build without relying on updater startup");
}

#[test]
fn stale_in_flight_completions_do_not_mutate_disabled_or_reenabled_state() {
    let now = UNIX_EPOCH + Duration::from_secs(1_787_875_200);
    let mut state = CounterState::default();
    apply_enabled(&mut state, true);
    let token = state.install_token.clone().unwrap();
    let enabled_generation = state.preference_generation;
    apply_enabled(&mut state, false);

    assert!(!record_install_success(
        &mut state,
        &token,
        enabled_generation,
        true,
        now
    ));
    assert!(!record_monthly_active_success(
        &mut state,
        "2026-08".to_string(),
        enabled_generation,
        now
    ));

    assert!(!state.enabled);
    assert!(!state.install_reported);
    assert!(state.pending_install_token.is_none());
    assert!(state.activity_secret.is_none());
    assert!(state.last_active_period.is_none());

    apply_enabled(&mut state, true);
    let reenabled_generation = state.preference_generation;
    assert!(!record_install_success(
        &mut state,
        &token,
        enabled_generation,
        true,
        now
    ));
    assert!(!record_monthly_active_success(
        &mut state,
        "2026-08".to_string(),
        enabled_generation,
        now
    ));
    assert_eq!(state.preference_generation, reenabled_generation);
    assert_eq!(
        state.pending_install_token.as_deref(),
        state.install_token.as_deref()
    );
    assert!(!state.install_reported);
    assert!(state.activity_secret.is_none());
    assert!(state.last_active_period.is_none());
}

#[test]
fn stale_telemetry_off_completion_cannot_clear_a_newer_reenable_cycle() {
    let now = UNIX_EPOCH + Duration::from_secs(1_787_875_200);
    let mut state = CounterState::default();
    apply_enabled(&mut state, true);
    apply_enabled(&mut state, false);
    let (_, disabled_generation, _) = prepare_telemetry_off_receipt(&mut state).unwrap();
    apply_enabled(&mut state, true);

    assert!(!record_telemetry_off_success(
        &mut state,
        disabled_generation,
        now
    ));
    assert!(state.enabled);
    assert_eq!(state.preference_generation, disabled_generation + 1);
    assert!(!state.telemetry_off_pending);
    assert!(!state.install_reported);
    assert!(state.pending_install_token.is_some());
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
