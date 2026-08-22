use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::{redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use self::protocol::{
    monthly_token, utc_epoch_seconds, utc_month, validate_endpoint, CounterPayload,
};

mod protocol;
#[cfg(test)]
mod tests;

const COUNTER_STATE_FILE: &str = "install-counter-v1.json";
const COUNTER_SCHEMA: u8 = 1;
const COUNTER_TIMEOUT: Duration = Duration::from_secs(5);
const LAUNCH_INSTALL_DELAY: Duration = Duration::from_secs(30);
const ACTIVE_DELAY_AFTER_INSTALL: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct InstallCounterManager {
    state_lock: Mutex<()>,
    reporting: AtomicBool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CounterState {
    consent: bool,
    install_reported: bool,
    pending_install_token: Option<String>,
    activity_secret: Option<String>,
    last_active_period: Option<String>,
    last_success_epoch_seconds: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallCounterStatus {
    available: bool,
    consented: bool,
    install_reported: bool,
    last_active_period: Option<String>,
    last_success_epoch_seconds: Option<u64>,
}

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(COUNTER_STATE_FILE))
        .map_err(|error| format!("failed to resolve counter state directory: {error}"))
}

fn read_state(path: &Path) -> CounterState {
    fs::read(path)
        .ok()
        .and_then(|contents| serde_json::from_slice(&contents).ok())
        .unwrap_or_default()
}

fn write_state(path: &Path, state: &CounterState) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "counter state path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create counter state directory: {error}"))?;
    let temporary_path = parent.join(format!(".{COUNTER_STATE_FILE}.{}.tmp", std::process::id()));
    let contents = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("failed to serialize counter state: {error}"))?;

    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&temporary_path)
            .map_err(|error| format!("failed to create counter state: {error}"))?
    };
    #[cfg(not(unix))]
    let mut file = fs::File::create(&temporary_path)
        .map_err(|error| format!("failed to create counter state: {error}"))?;

    file.write_all(&contents)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("failed to write counter state: {error}"))?;
    drop(file);

    #[cfg(target_os = "windows")]
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("failed to replace counter state: {error}"))?;
    }
    fs::rename(&temporary_path, path)
        .map_err(|error| format!("failed to commit counter state: {error}"))
}

fn random_identifier(byte_count: usize) -> String {
    let mut bytes = Vec::with_capacity(byte_count);
    while bytes.len() < byte_count {
        bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    }
    bytes.truncate(byte_count);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn apply_consent(state: &mut CounterState, enabled: bool) {
    state.consent = enabled;
    if enabled {
        if !state.install_reported && state.pending_install_token.is_none() {
            state.pending_install_token = Some(random_identifier(16));
        }
        if state.activity_secret.is_none() {
            state.activity_secret = Some(random_identifier(32));
        }
        return;
    }

    state.pending_install_token = None;
    state.activity_secret = None;
}

fn record_install_success(state: &mut CounterState, now: SystemTime) {
    state.install_reported = true;
    state.pending_install_token = None;
    state.last_success_epoch_seconds = Some(utc_epoch_seconds(now));
}

fn record_monthly_active_success(state: &mut CounterState, period: String, now: SystemTime) {
    state.last_active_period = Some(period);
    state.last_success_epoch_seconds = Some(utc_epoch_seconds(now));
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
        consented: state.consent,
        install_reported: state.install_reported,
        last_active_period: state.last_active_period.clone(),
        last_success_epoch_seconds: state.last_success_epoch_seconds,
    }
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
    Ok(status_from_state(&read_state(&state_path(&app)?)))
}

#[tauri::command]
pub fn set_install_counter_consent(
    app: tauri::AppHandle,
    manager: tauri::State<'_, InstallCounterManager>,
    consented: bool,
) -> Result<InstallCounterStatus, String> {
    if consented && configured_endpoint().is_none() {
        return Err("anonymous installation counting is not configured in this build".to_string());
    }

    let status = {
        let _guard = manager
            .state_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let path = state_path(&app)?;
        let mut state = read_state(&path);
        apply_consent(&mut state, consented);
        write_state(&path, &state)?;
        status_from_state(&state)
    };

    if consented {
        schedule_report_cycle(&app, Duration::ZERO);
    }
    Ok(status)
}

pub fn schedule_on_launch(app: &tauri::AppHandle) {
    schedule_report_cycle(app, LAUNCH_INSTALL_DELAY);
}

fn schedule_report_cycle(app: &tauri::AppHandle, initial_delay: Duration) {
    let Some(endpoint) = configured_endpoint() else {
        return;
    };
    let manager = app.state::<InstallCounterManager>();
    let Ok(path) = state_path(app) else {
        return;
    };
    let consented = manager
        .state_lock
        .lock()
        .ok()
        .is_some_and(|_guard| read_state(&path).consent);
    if !consented || manager.reporting.swap(true, Ordering::AcqRel) {
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
        if !state.consent || state.install_reported {
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
        if !state.consent || state.last_active_period.as_deref() == Some(period.as_str()) {
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
