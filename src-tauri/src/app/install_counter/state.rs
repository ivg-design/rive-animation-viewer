use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::protocol::utc_epoch_seconds;
use super::NOTICE_VERSION;

pub(super) const COUNTER_STATE_FILE: &str = "install-counter-v1.json";
const COUNTER_DISABLED_MARKER: &str = "install-counter-disabled-v1";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CounterState {
    #[serde(default, alias = "consent")]
    pub(super) enabled: bool,
    #[serde(default)]
    pub(super) notice_version: u16,
    pub(super) install_reported: bool,
    pub(super) pending_install_token: Option<String>,
    pub(super) activity_secret: Option<String>,
    pub(super) last_active_period: Option<String>,
    pub(super) last_success_epoch_seconds: Option<u64>,
}

pub(super) fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(COUNTER_STATE_FILE))
        .map_err(|error| format!("failed to resolve counter state directory: {error}"))
}

pub(super) fn read_state(path: &Path) -> CounterState {
    let mut state = fs::read(path)
        .ok()
        .and_then(|contents| serde_json::from_slice(&contents).ok())
        .unwrap_or_default();
    match disabled_marker_exists(path) {
        Ok(true) => apply_enabled(&mut state, false),
        Ok(false) => {}
        Err(_) => return CounterState::default(),
    }
    state
}

pub(super) fn disabled_marker_path(path: &Path) -> PathBuf {
    path.parent()
        .unwrap_or_else(|| Path::new("."))
        .join(COUNTER_DISABLED_MARKER)
}

fn disabled_marker_exists(path: &Path) -> Result<bool, String> {
    match fs::metadata(disabled_marker_path(path)) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("failed to read counter opt-out marker: {error}")),
    }
}

pub(super) fn ensure_state(path: &Path, enabled_by_default: bool) -> Result<CounterState, String> {
    let disabled_marker_exists = disabled_marker_exists(path)?;
    match fs::read(path) {
        Ok(contents) => {
            if let Ok(mut state) = serde_json::from_slice::<CounterState>(&contents) {
                if disabled_marker_exists && state.enabled {
                    apply_enabled(&mut state, false);
                    state.notice_version = NOTICE_VERSION;
                    write_state(path, &state)?;
                } else if !state.enabled && !disabled_marker_exists {
                    write_state(path, &state)?;
                }
                return Ok(state);
            }
            let state = CounterState {
                notice_version: NOTICE_VERSION,
                ..CounterState::default()
            };
            write_state(path, &state)?;
            return Ok(state);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("failed to read counter state: {error}")),
    }

    let mut state = CounterState {
        notice_version: if disabled_marker_exists {
            NOTICE_VERSION
        } else {
            0
        },
        ..CounterState::default()
    };
    apply_enabled(&mut state, enabled_by_default && !disabled_marker_exists);
    write_state(path, &state)?;
    Ok(state)
}

fn write_disabled_marker(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(path)
            .map_err(|error| format!("failed to create counter opt-out marker: {error}"))?
    };
    #[cfg(not(unix))]
    let mut file = fs::File::create(path)
        .map_err(|error| format!("failed to create counter opt-out marker: {error}"))?;
    file.write_all(b"disabled\n")
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("failed to persist counter opt-out marker: {error}"))
}

pub(super) fn write_state(path: &Path, state: &CounterState) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "counter state path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create counter state directory: {error}"))?;
    let disabled_marker = disabled_marker_path(path);
    if !state.enabled {
        write_disabled_marker(&disabled_marker)?;
    }
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
        .map_err(|error| format!("failed to commit counter state: {error}"))?;
    if state.enabled {
        match fs::remove_file(disabled_marker) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("failed to clear counter opt-out marker: {error}")),
        }
    }
    Ok(())
}

fn random_identifier(byte_count: usize) -> String {
    let mut bytes = Vec::with_capacity(byte_count);
    while bytes.len() < byte_count {
        bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    }
    bytes.truncate(byte_count);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(super) fn apply_enabled(state: &mut CounterState, enabled: bool) {
    state.enabled = enabled;
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

pub(super) fn record_install_success(state: &mut CounterState, now: SystemTime) {
    state.install_reported = true;
    state.pending_install_token = None;
    state.last_success_epoch_seconds = Some(utc_epoch_seconds(now));
}

pub(super) fn record_monthly_active_success(
    state: &mut CounterState,
    period: String,
    now: SystemTime,
) {
    state.last_active_period = Some(period);
    state.last_success_epoch_seconds = Some(utc_epoch_seconds(now));
}
