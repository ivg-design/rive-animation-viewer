use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime};

use reqwest::{redirect::Policy, Url};
use tauri::Manager;

use super::protocol::{utc_month, CounterPayload};
use super::state::{
    pending_telemetry_off, read_state, record_install_success, record_monthly_active_success,
    record_telemetry_off_success, state_path, write_state, CounterState,
};
use super::{configured_endpoint, reporting_is_ready, InstallCounterManager, COUNTER_SCHEMA};

const COUNTER_TIMEOUT: Duration = Duration::from_secs(5);
pub(super) const LAUNCH_INSTALL_DELAY: Duration = Duration::from_secs(30);
const ACTIVE_DELAY_AFTER_INSTALL: Duration = Duration::from_secs(60);

pub(super) fn reporting_work_is_pending(state: &CounterState, now: SystemTime) -> bool {
    pending_telemetry_off(state).is_some()
        || (reporting_is_ready(state)
            && (state.status_synced_generation != Some(state.preference_generation)
                || state.last_active_period.as_deref() != Some(utc_month(now).as_str())))
}

pub(super) fn schedule_report_cycle(app: &tauri::AppHandle, initial_delay: Duration) {
    let Some(endpoint) = configured_endpoint() else {
        return;
    };
    let manager = app.state::<InstallCounterManager>();
    let Ok(path) = state_path(app) else {
        return;
    };
    let ready = manager.state_lock.lock().ok().is_some_and(|_guard| {
        let state = read_state(&path);
        reporting_work_is_pending(&state, SystemTime::now())
    });
    if !ready || manager.reporting.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(initial_delay).await;
        let started_generation = current_preference_generation(&app).unwrap_or_default();
        match report_telemetry_off_if_needed(&app, &endpoint).await {
            Ok(true) => {
                finish_report_cycle(&app, started_generation);
                return;
            }
            Err(error) => {
                eprintln!("[rav-counter] telemetry-off receipt deferred: {error}");
                app.state::<InstallCounterManager>()
                    .reporting
                    .store(false, Ordering::Release);
                return;
            }
            Ok(false) => {}
        }
        if let Err(error) = report_install_if_needed(&app, &endpoint).await {
            eprintln!("[rav-counter] installation report deferred: {error}");
        }
        tokio::time::sleep(ACTIVE_DELAY_AFTER_INSTALL).await;
        if let Err(error) = report_monthly_active_if_needed(&app, &endpoint).await {
            eprintln!("[rav-counter] monthly activity report deferred: {error}");
        }
        finish_report_cycle(&app, started_generation);
    });
}

fn current_preference_generation(app: &tauri::AppHandle) -> Result<u64, String> {
    let manager = app.state::<InstallCounterManager>();
    let path = state_path(app)?;
    let _guard = manager
        .state_lock
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(read_state(&path).preference_generation)
}

fn finish_report_cycle(app: &tauri::AppHandle, started_generation: u64) {
    let manager = app.state::<InstallCounterManager>();
    manager.reporting.store(false, Ordering::Release);
    let Ok(path) = state_path(app) else {
        return;
    };
    let preference_changed_with_pending_work =
        manager.state_lock.lock().ok().is_some_and(|_guard| {
            let state = read_state(&path);
            state.preference_generation != started_generation
                && reporting_work_is_pending(&state, SystemTime::now())
        });
    if preference_changed_with_pending_work {
        schedule_report_cycle(app, Duration::ZERO);
    }
}

pub(super) async fn report_telemetry_off_if_needed(
    app: &tauri::AppHandle,
    endpoint: &Url,
) -> Result<bool, String> {
    let manager = app.state::<InstallCounterManager>();
    // The Settings command sends promptly while a launch-cycle task can be
    // sleeping or already waking. Claim the one durable receipt before either
    // path reads it, so those paths coalesce instead of producing two POSTs.
    if !claim_telemetry_off_attempt(&manager.telemetry_off_reporting) {
        return Ok(false);
    }
    let result = report_claimed_telemetry_off_if_needed(app, endpoint).await;
    manager
        .telemetry_off_reporting
        .store(false, Ordering::Release);
    result
}

pub(super) fn claim_telemetry_off_attempt(in_flight: &std::sync::atomic::AtomicBool) -> bool {
    in_flight
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
}

async fn report_claimed_telemetry_off_if_needed(
    app: &tauri::AppHandle,
    endpoint: &Url,
) -> Result<bool, String> {
    let manager = app.state::<InstallCounterManager>();
    let path = state_path(app)?;
    let pending = {
        let _guard = manager
            .state_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let state = read_state(&path);
        pending_telemetry_off(&state)
    };
    let Some((token, preference_generation, establish_install)) = pending else {
        return Ok(false);
    };
    let payload = CounterPayload {
        schema: COUNTER_SCHEMA,
        event: "telemetry_off",
        token: token.clone(),
        release: app.package_info().version.to_string(),
        preference_generation,
        period: None,
        status: Some("disabled"),
        establish_install: Some(establish_install),
    };
    send_payload(endpoint, &payload).await?;
    let _guard = manager
        .state_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut state = read_state(&path);
    if record_telemetry_off_success(&mut state, preference_generation, SystemTime::now()) {
        write_state(&path, &state)?;
    }
    Ok(true)
}

async fn send_payload(endpoint: &Url, payload: &CounterPayload) -> Result<(), String> {
    let client = build_counter_client()?;
    send_payload_with_client(&client, endpoint, payload).await
}

pub(super) async fn send_payload_with_client(
    client: &reqwest::Client,
    endpoint: &Url,
    payload: &CounterPayload,
) -> Result<(), String> {
    let response = client
        .post(endpoint.clone())
        .json(payload)
        .send()
        .await
        .map_err(|error| format!("counter endpoint unavailable: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("counter endpoint returned {}", response.status()));
    }
    Ok(())
}

pub(super) fn build_counter_client() -> Result<reqwest::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(COUNTER_TIMEOUT)
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("counter client unavailable: {error}"))
}

async fn report_install_if_needed(app: &tauri::AppHandle, endpoint: &Url) -> Result<(), String> {
    let manager = app.state::<InstallCounterManager>();
    let path = state_path(app)?;
    let pending_report = {
        let _guard = manager
            .state_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let state = read_state(&path);
        if !state.enabled || state.status_synced_generation == Some(state.preference_generation) {
            return Ok(());
        }
        state
            .pending_install_token
            .map(|token| (token, state.preference_generation, !state.install_reported))
    };
    let Some((token, preference_generation, establish_install)) = pending_report else {
        return Ok(());
    };
    let payload = CounterPayload {
        schema: COUNTER_SCHEMA,
        event: "install",
        token: token.clone(),
        release: app.package_info().version.to_string(),
        preference_generation,
        period: None,
        status: None,
        establish_install: Some(establish_install),
    };
    send_payload(endpoint, &payload).await?;
    let _guard = manager
        .state_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut state = read_state(&path);
    if record_install_success(
        &mut state,
        &token,
        preference_generation,
        establish_install,
        SystemTime::now(),
    ) {
        write_state(&path, &state)?;
    }
    Ok(())
}

async fn report_monthly_active_if_needed(
    app: &tauri::AppHandle,
    endpoint: &Url,
) -> Result<(), String> {
    let manager = app.state::<InstallCounterManager>();
    let path = state_path(app)?;
    let period = utc_month(SystemTime::now());
    let pending_report = {
        let _guard = manager
            .state_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let state = read_state(&path);
        if !state.enabled
            || state.status_synced_generation != Some(state.preference_generation)
            || state.last_active_period.as_deref() == Some(period.as_str())
        {
            return Ok(());
        }
        state
            .install_token
            .map(|token| (token, state.preference_generation))
    };
    let Some((token, preference_generation)) = pending_report else {
        return Ok(());
    };
    let payload = CounterPayload {
        schema: COUNTER_SCHEMA,
        event: "monthly_active",
        token,
        release: app.package_info().version.to_string(),
        preference_generation,
        period: Some(period.clone()),
        status: None,
        establish_install: None,
    };
    send_payload(endpoint, &payload).await?;
    let _guard = manager
        .state_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut state = read_state(&path);
    if record_monthly_active_success(&mut state, period, preference_generation, SystemTime::now()) {
        write_state(&path, &state)?;
    }
    Ok(())
}
