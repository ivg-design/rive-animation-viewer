use std::{
    fs,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, UNIX_EPOCH},
};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::super::*;

#[test]
fn telemetry_off_receipt_uses_the_existing_install_identifier_and_is_prepared_once_per_opt_out() {
    let mut state = CounterState::default();
    apply_enabled(&mut state, true);

    let install_token = state.pending_install_token.clone().unwrap();
    apply_enabled(&mut state, false);
    let (receipt_token, generation, establish_install) =
        prepare_telemetry_off_receipt(&mut state).unwrap();
    assert_eq!(receipt_token.len(), 22);
    assert_eq!(receipt_token, install_token);
    assert_eq!(generation, 2);
    assert!(establish_install);

    assert!(!state.enabled);
    assert!(state.telemetry_off_attempted);
    assert!(state.telemetry_off_pending);
    assert_eq!(
        pending_telemetry_off(&state),
        Some((install_token.clone(), 2, true))
    );
    assert!(state.pending_install_token.is_none());
    assert!(state.activity_secret.is_none());
    assert!(prepare_telemetry_off_receipt(&mut state).is_none());

    apply_enabled(&mut state, true);
    assert!(record_install_success(
        &mut state,
        &install_token,
        3,
        true,
        UNIX_EPOCH + Duration::from_secs(1)
    ));
    apply_enabled(&mut state, false);
    assert_eq!(
        prepare_telemetry_off_receipt(&mut state),
        Some((install_token, 4, false))
    );
}

#[test]
fn telemetry_off_payload_has_no_period_or_extra_fields() {
    let payload = CounterPayload {
        schema: 2,
        event: "telemetry_off",
        token: "abcdefghijklmnopqrstuv".to_string(),
        release: "2.5.1".to_string(),
        preference_generation: 2,
        period: None,
        status: Some("disabled"),
        establish_install: Some(false),
    };
    let value = serde_json::to_value(payload).unwrap();
    let Value::Object(fields) = value else {
        panic!("counter payload must be an object");
    };
    assert_eq!(
        fields.keys().cloned().collect::<Vec<_>>(),
        vec![
            "establishInstall",
            "event",
            "preferenceGeneration",
            "release",
            "schema",
            "status",
            "token"
        ]
    );
}

#[test]
fn concurrent_telemetry_off_senders_coalesce_to_one_claim() {
    let in_flight = AtomicBool::new(false);
    assert!(reporting_cycle::claim_telemetry_off_attempt(&in_flight));
    assert!(!reporting_cycle::claim_telemetry_off_attempt(&in_flight));

    // Completion releases the claim, allowing the same durable receipt to be
    // retried deliberately after a timeout or non-2xx response.
    in_flight.store(false, Ordering::Release);
    assert!(reporting_cycle::claim_telemetry_off_attempt(&in_flight));
}

#[tokio::test]
async fn telemetry_off_http_boundary_posts_the_exact_payload_and_requires_success() {
    async fn receive(status: &str) -> (reqwest::Url, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_string();
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 2048];
            let header_end;
            loop {
                let count = stream.read(&mut buffer).await.unwrap();
                assert!(count > 0, "request ended before its headers");
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(index) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    header_end = index + 4;
                    break;
                }
            }
            let headers = String::from_utf8_lossy(&bytes[..header_end]);
            let length = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(str::trim)
                        .map(str::parse::<usize>)
                })
                .transpose()
                .unwrap()
                .unwrap();
            while bytes.len() < header_end + length {
                let count = stream.read(&mut buffer).await.unwrap();
                assert!(count > 0, "request ended before its body");
                bytes.extend_from_slice(&buffer[..count]);
            }
            stream
                .write_all(
                    format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        .as_bytes(),
                )
                .await
                .unwrap();
            String::from_utf8(bytes[header_end..header_end + length].to_vec()).unwrap()
        });
        (
            reqwest::Url::parse(&format!("http://{address}/v1/event")).unwrap(),
            task,
        )
    }

    let payload = CounterPayload {
        schema: 2,
        event: "telemetry_off",
        token: "abcdefghijklmnopqrstuv".to_string(),
        release: "2.5.2".to_string(),
        preference_generation: 2,
        period: None,
        status: Some("disabled"),
        establish_install: Some(false),
    };
    let client = reporting_cycle::build_counter_client().unwrap();

    let (endpoint, request) = receive("204 No Content").await;
    reporting_cycle::send_payload_with_client(&client, &endpoint, &payload)
        .await
        .unwrap();
    let body: Value = serde_json::from_str(&request.await.unwrap()).unwrap();
    assert_eq!(body, serde_json::to_value(&payload).unwrap());

    let (endpoint, request) = receive("503 Service Unavailable").await;
    let error = reporting_cycle::send_payload_with_client(&client, &endpoint, &payload)
        .await
        .unwrap_err();
    assert_eq!(error, "counter endpoint returned 503 Service Unavailable");
    let _ = request.await.unwrap();
}

#[test]
fn marker_recovers_a_pending_off_receipt_when_json_replacement_never_commits() {
    let directory = std::env::temp_dir().join(format!(
        "rav-counter-marker-crash-window-{}",
        uuid::Uuid::new_v4()
    ));
    let path = directory.join(state::COUNTER_STATE_FILE);
    let mut state = ensure_state(&path, true).unwrap();
    let pre_opt_out_json = fs::read(&path).unwrap();

    apply_enabled(&mut state, false);
    let expected = prepare_telemetry_off_receipt(&mut state).unwrap();
    write_state(&path, &state).unwrap();
    assert!(state::disabled_marker_path(&path).is_file());

    // This is the exact crash window: the marker is durable, while the state
    // file still contains the previous enabled JSON.
    fs::write(&path, pre_opt_out_json).unwrap();
    let restored = ensure_state(&path, true).unwrap();
    assert!(!restored.enabled);
    assert_eq!(pending_telemetry_off(&restored), Some(expected.clone()));
    assert!(restored.telemetry_off_attempted);

    // The marker also owns the minimum retry record if a crash leaves no
    // replace target (or a torn target) at all.
    fs::remove_file(&path).unwrap();
    let restored = ensure_state(&path, true).unwrap();
    assert_eq!(pending_telemetry_off(&restored), Some(expected.clone()));
    fs::write(&path, b"torn state").unwrap();
    let restored = ensure_state(&path, true).unwrap();
    assert_eq!(pending_telemetry_off(&restored), Some(expected));

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn unavailable_status_reads_do_not_create_an_opt_out_marker() {
    let directory = std::env::temp_dir().join(format!(
        "rav-counter-unavailable-status-{}",
        uuid::Uuid::new_v4()
    ));
    let path = directory.join(state::COUNTER_STATE_FILE);

    let state = state_for_status(&path, false).unwrap();
    assert!(!state.enabled);
    assert!(!path.exists());
    assert!(!state::disabled_marker_path(&path).exists());

    fs::create_dir_all(&directory).unwrap();
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn failed_telemetry_off_delivery_is_durable_until_a_later_success_or_explicit_reenable() {
    let directory = std::env::temp_dir().join(format!(
        "rav-counter-telemetry-off-attempt-{}",
        uuid::Uuid::new_v4()
    ));
    let path = directory.join(state::COUNTER_STATE_FILE);
    let mut counter_state = ensure_state(&path, true).unwrap();

    apply_enabled(&mut counter_state, false);
    assert!(prepare_telemetry_off_receipt(&mut counter_state).is_some());
    write_state(&path, &counter_state).unwrap();

    let mut restored = read_state(&path);
    assert!(restored.telemetry_off_attempted);
    assert!(restored.telemetry_off_pending);
    let (receipt_token, generation, establish_install) = pending_telemetry_off(&restored).unwrap();
    assert_eq!(receipt_token, restored.install_token.clone().unwrap());
    assert!(establish_install);

    // A timeout/5xx records no success, so the next launch sees the same
    // idempotent pending receipt. A 2xx clears it durably.
    assert!(record_telemetry_off_success(
        &mut restored,
        generation,
        UNIX_EPOCH + Duration::from_secs(7)
    ));
    write_state(&path, &restored).unwrap();
    let delivered = read_state(&path);
    assert!(!delivered.telemetry_off_pending);
    assert!(pending_telemetry_off(&delivered).is_none());

    let mut restored = delivered;
    apply_enabled(&mut restored, true);
    write_state(&path, &restored).unwrap();

    let mut reenabled = read_state(&path);
    assert!(reenabled.enabled);
    assert!(!reenabled.telemetry_off_attempted);
    assert!(!reenabled.telemetry_off_pending);
    apply_enabled(&mut reenabled, false);
    assert!(prepare_telemetry_off_receipt(&mut reenabled).is_some());

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn legacy_enabled_install_syncs_status_without_reestablishing_its_aggregate() {
    let directory = std::env::temp_dir().join(format!(
        "rav-counter-legacy-status-sync-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join(state::COUNTER_STATE_FILE);
    fs::write(
        &path,
        serde_json::to_vec(&serde_json::json!({
            "enabled": true,
            "noticeVersion": NOTICE_VERSION,
            "installReported": true,
            "pendingInstallToken": null,
            "activitySecret": URL_SAFE_NO_PAD.encode([7_u8; 32]),
            "lastActivePeriod": null,
            "lastSuccessEpochSeconds": 1
        }))
        .unwrap(),
    )
    .unwrap();

    let mut restored = ensure_state(&path, true).unwrap();
    let token = restored.install_token.clone().unwrap();
    assert!(restored.enabled);
    assert!(restored.install_reported);
    assert_eq!(restored.preference_generation, 0);
    assert_eq!(restored.status_synced_generation, None);
    assert_eq!(
        restored.pending_install_token.as_deref(),
        Some(token.as_str())
    );
    assert!(restored.activity_secret.is_none());
    assert!(reporting_work_is_pending(&restored, UNIX_EPOCH));

    assert!(record_install_success(
        &mut restored,
        &token,
        0,
        false,
        UNIX_EPOCH + Duration::from_secs(2)
    ));
    assert!(restored.install_reported);
    assert_eq!(restored.status_synced_generation, Some(0));

    apply_enabled(&mut restored, false);
    let (_, disabled_generation, establish_install) =
        prepare_telemetry_off_receipt(&mut restored).unwrap();
    assert_eq!(disabled_generation, 1);
    assert!(!establish_install);
    assert!(record_telemetry_off_success(
        &mut restored,
        disabled_generation,
        UNIX_EPOCH + Duration::from_secs(3)
    ));

    apply_enabled(&mut restored, true);
    assert!(restored.install_reported);
    assert_eq!(restored.preference_generation, 2);
    assert_ne!(
        restored.status_synced_generation,
        Some(restored.preference_generation)
    );
    assert_eq!(
        restored.pending_install_token.as_deref(),
        Some(token.as_str())
    );

    fs::remove_dir_all(directory).unwrap();
}
