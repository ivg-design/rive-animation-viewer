use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use tauri::Manager;

pub(super) use self::disabled_marker::disabled_marker_path;
use self::disabled_marker::{apply_disabled_marker, read_disabled_marker, write_disabled_marker};
use super::protocol::utc_epoch_seconds;
use super::NOTICE_VERSION;

mod disabled_marker;

pub(super) const COUNTER_STATE_FILE: &str = "install-counter-v1.json";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CounterState {
    #[serde(default, alias = "consent")]
    pub(super) enabled: bool,
    #[serde(default)]
    pub(super) notice_version: u16,
    pub(super) install_reported: bool,
    /// Stable, random installation identifier. It is sent only to the counter
    /// endpoint and lets a final opt-out update the status of this installation.
    #[serde(default)]
    pub(super) install_token: Option<String>,
    #[serde(default)]
    pub(super) preference_generation: u64,
    #[serde(default)]
    pub(super) status_synced_generation: Option<u64>,
    pub(super) pending_install_token: Option<String>,
    /// Kept only to migrate pre-v2 state into the stable anonymous install
    /// token. New state never creates or reports this legacy value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) activity_secret: Option<String>,
    #[serde(default)]
    pub(super) telemetry_off_attempted: bool,
    #[serde(default)]
    pub(super) telemetry_off_pending: bool,
    #[serde(default)]
    pub(super) telemetry_off_establish_install: bool,
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
    match read_disabled_marker(path) {
        Ok(Some(marker)) => apply_disabled_marker(&mut state, &marker),
        Ok(None) => {}
        Err(_) => return CounterState::default(),
    }
    state
}

pub(super) fn ensure_state(path: &Path, enabled_by_default: bool) -> Result<CounterState, String> {
    let disabled_marker = read_disabled_marker(path)?;
    match fs::read(path) {
        Ok(contents) => {
            if let Ok(mut state) = serde_json::from_slice::<CounterState>(&contents) {
                let normalized = normalize_install_identifier(&mut state);
                if let Some(marker) = disabled_marker.as_ref() {
                    let was_enabled = state.enabled;
                    apply_disabled_marker(&mut state, marker);
                    state.notice_version = NOTICE_VERSION;
                    // A stale marker can survive a crash after the re-enable
                    // JSON commit but before marker removal. Make that durable
                    // opt-out authoritative at the endpoint too.
                    if was_enabled && !state.telemetry_off_pending {
                        let _ = prepare_telemetry_off_receipt(&mut state);
                    }
                    write_state(path, &state)?;
                } else if !state.enabled || normalized {
                    write_state(path, &state)?;
                }
                return Ok(state);
            }
            let mut state = CounterState {
                notice_version: NOTICE_VERSION,
                ..CounterState::default()
            };
            if let Some(marker) = disabled_marker.as_ref() {
                apply_disabled_marker(&mut state, marker);
            }
            write_state(path, &state)?;
            return Ok(state);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("failed to read counter state: {error}")),
    }

    let mut state = CounterState {
        notice_version: if disabled_marker.is_some() {
            NOTICE_VERSION
        } else {
            0
        },
        ..CounterState::default()
    };
    apply_enabled(&mut state, enabled_by_default && disabled_marker.is_none());
    if let Some(marker) = disabled_marker.as_ref() {
        apply_disabled_marker(&mut state, marker);
    }
    write_state(path, &state)?;
    Ok(state)
}

pub(super) fn write_state(path: &Path, state: &CounterState) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "counter state path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create counter state directory: {error}"))?;
    let disabled_marker = disabled_marker_path(path);
    if !state.enabled {
        write_disabled_marker(&disabled_marker, state)?;
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

pub(super) fn prepare_telemetry_off_receipt(
    state: &mut CounterState,
) -> Option<(String, u64, bool)> {
    if state.enabled || state.telemetry_off_attempted {
        return None;
    }
    state.telemetry_off_attempted = true;
    state.telemetry_off_pending = true;
    // install_reported is the durable local acknowledgement that the one
    // aggregate was established. Legacy true values therefore sync only
    // status for their replacement token instead of recounting the install.
    state.telemetry_off_establish_install = !state.install_reported;
    Some((
        install_identifier(state),
        state.preference_generation,
        state.telemetry_off_establish_install,
    ))
}

pub(super) fn pending_telemetry_off(state: &CounterState) -> Option<(String, u64, bool)> {
    if state.enabled || !state.telemetry_off_pending {
        return None;
    }
    state
        .install_token
        .as_deref()
        .filter(|token| valid_token(token))
        .map(|token| {
            (
                token.to_string(),
                state.preference_generation,
                state.telemetry_off_establish_install,
            )
        })
}

pub(super) fn apply_enabled(state: &mut CounterState, enabled: bool) {
    let was_enabled = state.enabled;
    if was_enabled != enabled {
        state.preference_generation = state.preference_generation.saturating_add(1);
    }
    state.enabled = enabled;
    if enabled {
        let install_token = install_identifier(state);
        if !was_enabled {
            // A deliberate re-enable starts a new reporting cycle for the same
            // anonymous installation identifier. The Worker deduplicates the
            // install ledger and changes its status back to enabled.
            state.telemetry_off_attempted = false;
            state.telemetry_off_pending = false;
            state.telemetry_off_establish_install = false;
            state.pending_install_token = Some(install_token);
        } else if state.status_synced_generation != Some(state.preference_generation)
            && state.pending_install_token.is_none()
        {
            state.pending_install_token = Some(install_token);
        }
        state.activity_secret = None;
        return;
    }
    state.pending_install_token = None;
    state.activity_secret = None;
}

pub(super) fn record_telemetry_off_success(
    state: &mut CounterState,
    preference_generation: u64,
    now: SystemTime,
) -> bool {
    if state.enabled
        || state.preference_generation != preference_generation
        || !state.telemetry_off_pending
    {
        return false;
    }
    state.telemetry_off_pending = false;
    if state.telemetry_off_establish_install {
        state.install_reported = true;
    }
    state.telemetry_off_establish_install = false;
    state.status_synced_generation = Some(preference_generation);
    state.last_success_epoch_seconds = Some(utc_epoch_seconds(now));
    true
}

fn install_identifier(state: &mut CounterState) -> String {
    if let Some(token) = state
        .install_token
        .as_deref()
        .filter(|token| valid_token(token))
    {
        return token.to_string();
    }
    if let Some(token) = state
        .pending_install_token
        .as_deref()
        .filter(|token| valid_token(token))
    {
        let token = token.to_string();
        state.install_token = Some(token.clone());
        return token;
    }
    // Builds before this field existed deleted the install token after its
    // first report. There is no way to reconstruct that deleted value. Derive
    // a stable replacement from their existing local activity secret so an
    // opt-out is still deterministic for that installed copy.
    if let Some(secret) = state.activity_secret.as_deref() {
        if let Ok(secret) = URL_SAFE_NO_PAD.decode(secret) {
            let digest = sha2::Sha256::digest(secret);
            let token = URL_SAFE_NO_PAD.encode(&digest[..16]);
            state.install_token = Some(token.clone());
            return token;
        }
    }
    let token = random_identifier(16);
    state.install_token = Some(token.clone());
    token
}

fn normalize_install_identifier(state: &mut CounterState) -> bool {
    let needed_identifier = !state.install_token.as_deref().is_some_and(valid_token);
    if needed_identifier {
        let _ = install_identifier(state);
    }
    let removed_legacy_secret = state.activity_secret.take().is_some();
    let needed_status_sync = state.enabled
        && state.status_synced_generation != Some(state.preference_generation)
        && state.pending_install_token.is_none();
    if needed_status_sync {
        state.pending_install_token = state.install_token.clone();
    }
    needed_identifier || removed_legacy_secret || needed_status_sync
}

fn valid_token(token: &str) -> bool {
    URL_SAFE_NO_PAD
        .decode(token)
        .map(|bytes| bytes.len() == 16)
        .unwrap_or(false)
}

pub(super) fn record_install_success(
    state: &mut CounterState,
    token: &str,
    preference_generation: u64,
    establish_install: bool,
    now: SystemTime,
) -> bool {
    if !state.enabled
        || state.preference_generation != preference_generation
        || state.pending_install_token.as_deref() != Some(token)
    {
        return false;
    }
    if establish_install {
        state.install_reported = true;
    }
    state.status_synced_generation = Some(preference_generation);
    state.pending_install_token = None;
    state.last_success_epoch_seconds = Some(utc_epoch_seconds(now));
    true
}

pub(super) fn record_monthly_active_success(
    state: &mut CounterState,
    period: String,
    preference_generation: u64,
    now: SystemTime,
) -> bool {
    if !state.enabled || state.preference_generation != preference_generation {
        return false;
    }
    state.last_active_period = Some(period);
    state.last_success_epoch_seconds = Some(utc_epoch_seconds(now));
    true
}
