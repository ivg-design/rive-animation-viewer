use std::fs;

use super::*;

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
    assert!(!state.telemetry_off_attempted);
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
