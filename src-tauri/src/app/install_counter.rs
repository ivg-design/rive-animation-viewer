use reqwest::{redirect::Policy, Url};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::Manager;

use self::protocol::{monthly_token, utc_month, validate_endpoint, CounterPayload};
use self::state::{
    apply_enabled, ensure_state, read_state, record_install_success, record_monthly_active_success,
    state_path, write_state, CounterState,
};

mod protocol;
mod state;
#[cfg(test)]
mod tests;

const COUNTER_SCHEMA: u8 = 1;
const NOTICE_VERSION: u16 = 1;
const COUNTER_TIMEOUT: Duration = Duration::from_secs(5);
const LAUNCH_INSTALL_DELAY: Duration = Duration::from_secs(30);
const ACTIVE_DELAY_AFTER_INSTALL: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct InstallCounterManager {
    state_lock: Mutex<()>,
    reporting: AtomicBool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallCounterStatus {
    available: bool,
    enabled: bool,
    notice_required: bool,
    install_reported: bool,
    last_active_period: Option<String>,
    last_success_epoch_seconds: Option<u64>,
}

fn configured_endpoint() -> Option<Url> {
    if cfg!(debug_assertions) || option_env!("RAV_OFFICIAL_RELEASE") != Some("1") {
        return None;
    }
    option_env!("RAV_COUNTER_ENDPOINT").and_then(|value| validate_endpoint(value).ok())
}

fn status_from_state(state: &CounterState) -> InstallCounterStatus {
    InstallCounterStatus {
        available: configured_endpoint().is_some(),
        enabled: state.enabled,
        notice_required: state.notice_version < NOTICE_VERSION,
        install_reported: state.install_reported,
        last_active_period: state.last_active_period.clone(),
        last_success_epoch_seconds: state.last_success_epoch_seconds,
    }
}

fn reporting_is_ready(state: &CounterState) -> bool {
    state.enabled && state.notice_version >= NOTICE_VERSION
}

#[tauri::command]
pub fn get_install_counter_status(
    app: tauri::AppHandle,
    manager: tauri::State<'_, InstallCounterManager>,
) -> Result<InstallCounterStatus, String> {
    let _guard = manager
        .state_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let path = state_path(&app)?;
    let state = ensure_state(&path, configured_endpoint().is_some())?;
    Ok(status_from_state(&state))
}

#[tauri::command]
pub fn set_install_counter_enabled(
    app: tauri::AppHandle,
    manager: tauri::State<'_, InstallCounterManager>,
    enabled: bool,
) -> Result<InstallCounterStatus, String> {
    if enabled && configured_endpoint().is_none() {
        return Err("anonymous installation counting is not configured in this build".to_string());
    }
    let status = {
        let _guard = manager
            .state_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let path = state_path(&app)?;
        let mut state = ensure_state(&path, configured_endpoint().is_some())?;
        apply_enabled(&mut state, enabled);
        if enabled {
            state.notice_version = NOTICE_VERSION;
        }
        write_state(&path, &state)?;
        status_from_state(&state)
    };
    if enabled && !status.notice_required {
        schedule_report_cycle(&app, Duration::ZERO);
    }
    Ok(status)
}

#[tauri::command]
pub fn acknowledge_install_counter_notice(
    app: tauri::AppHandle,
    manager: tauri::State<'_, InstallCounterManager>,
) -> Result<InstallCounterStatus, String> {
    let status = {
        let _guard = manager
            .state_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let path = state_path(&app)?;
        let mut state = ensure_state(&path, configured_endpoint().is_some())?;
        state.notice_version = NOTICE_VERSION;
        write_state(&path, &state)?;
        status_from_state(&state)
    };
    if status.available && status.enabled {
        schedule_report_cycle(&app, LAUNCH_INSTALL_DELAY);
    }
    Ok(status)
}

pub fn schedule_on_launch(app: &tauri::AppHandle) {
    let Some(_) = configured_endpoint() else {
        return;
    };
    let manager = app.state::<InstallCounterManager>();
    let Ok(path) = state_path(app) else {
        return;
    };
    let ready = manager
        .state_lock
        .lock()
        .ok()
        .and_then(|_guard| ensure_state(&path, true).ok())
        .is_some_and(|state| reporting_is_ready(&state));
    if ready {
        schedule_report_cycle(app, LAUNCH_INSTALL_DELAY);
    }
}

fn schedule_report_cycle(app: &tauri::AppHandle, initial_delay: Duration) {
    let Some(endpoint) = configured_endpoint() else {
        return;
    };
    let manager = app.state::<InstallCounterManager>();
    let Ok(path) = state_path(app) else {
        return;
    };
    let enabled = manager.state_lock.lock().ok().is_some_and(|_guard| {
        let state = read_state(&path);
        reporting_is_ready(&state)
    });
    if !enabled || manager.reporting.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(initial_delay).await;
        if let Err(error) = report_install_if_needed(&app, &endpoint).await {
            eprintln!("[rav-counter] installation report deferred: {error}");
        }
        tokio::time::sleep(ACTIVE_DELAY_AFTER_INSTALL).await;
        if let Err(error) = report_monthly_active_if_needed(&app, &endpoint).await {
            eprintln!("[rav-counter] monthly activity report deferred: {error}");
        }
        app.state::<InstallCounterManager>()
            .reporting
            .store(false, Ordering::Release);
    });
}

async fn send_payload(endpoint: &Url, payload: &CounterPayload) -> Result<(), String> {
    let client = build_counter_client()?;
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

fn build_counter_client() -> Result<reqwest::Client, String> {
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
    let pending_token = {
        let _guard = manager
            .state_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let state = read_state(&path);
        if !state.enabled || state.install_reported {
            return Ok(());
        }
        state.pending_install_token
    };
    let Some(token) = pending_token else {
        return Ok(());
    };
    let payload = CounterPayload {
        schema: COUNTER_SCHEMA,
        event: "install",
        token: token.clone(),
        release: app.package_info().version.to_string(),
        period: None,
    };
    send_payload(endpoint, &payload).await?;
    let _guard = manager
        .state_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut state = read_state(&path);
    record_install_success(&mut state, SystemTime::now());
    write_state(&path, &state)?;
    Ok(())
}

async fn report_monthly_active_if_needed(
    app: &tauri::AppHandle,
    endpoint: &Url,
) -> Result<(), String> {
    let manager = app.state::<InstallCounterManager>();
    let path = state_path(app)?;
    let period = utc_month(SystemTime::now());
    let secret = {
        let _guard = manager
            .state_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let state = read_state(&path);
        if !state.enabled || state.last_active_period.as_deref() == Some(period.as_str()) {
            return Ok(());
        }
        state.activity_secret
    };
    let Some(secret) = secret else {
        return Ok(());
    };
    let token = monthly_token(&secret, &period)?;
    let payload = CounterPayload {
        schema: COUNTER_SCHEMA,
        event: "monthly_active",
        token,
        release: app.package_info().version.to_string(),
        period: Some(period.clone()),
    };
    send_payload(endpoint, &payload).await?;
    let _guard = manager
        .state_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut state = read_state(&path);
    record_monthly_active_success(&mut state, period, SystemTime::now());
    write_state(&path, &state)?;
    Ok(())
}
