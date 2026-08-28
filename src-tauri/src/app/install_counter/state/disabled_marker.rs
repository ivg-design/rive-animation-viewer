use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{apply_enabled, valid_token, CounterState};

pub(super) const COUNTER_DISABLED_MARKER: &str = "install-counter-disabled-v1";

/// A privacy-first crash-recovery record. The marker is deliberately written
/// before the normal state-file replacement: should the process stop in that
/// window, recovery can still keep reporting disabled and retry the one
/// already-requested control receipt with the same opaque identity.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DisabledMarker {
    #[serde(default)]
    schema: u8,
    #[serde(default)]
    install_token: Option<String>,
    #[serde(default)]
    preference_generation: u64,
    #[serde(default)]
    telemetry_off_pending: bool,
    #[serde(default)]
    telemetry_off_establish_install: bool,
}

pub(in crate::app::install_counter) fn disabled_marker_path(path: &Path) -> PathBuf {
    path.parent()
        .unwrap_or_else(|| Path::new("."))
        .join(COUNTER_DISABLED_MARKER)
}

pub(super) fn read_disabled_marker(path: &Path) -> Result<Option<DisabledMarker>, String> {
    match fs::read(disabled_marker_path(path)) {
        Ok(contents) => {
            // Preserve compatibility with the old one-word marker. It still
            // fails closed, though it cannot recover a receipt predating this
            // format.
            let marker = serde_json::from_slice::<DisabledMarker>(&contents).unwrap_or_default();
            Ok(Some(if marker.schema == 1 {
                marker
            } else {
                DisabledMarker::default()
            }))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("failed to read counter opt-out marker: {error}")),
    }
}

pub(super) fn apply_disabled_marker(state: &mut CounterState, marker: &DisabledMarker) {
    apply_enabled(state, false);
    if !marker.telemetry_off_pending {
        return;
    }
    let Some(token) = marker
        .install_token
        .as_deref()
        .filter(|token| valid_token(token))
    else {
        return;
    };
    // The marker can be newer than the JSON file by one atomic-replace window.
    // Never move the preference generation backwards when merging it.
    state.preference_generation = state
        .preference_generation
        .max(marker.preference_generation);
    state.install_token = Some(token.to_string());
    state.telemetry_off_attempted = true;
    state.telemetry_off_pending = true;
    state.telemetry_off_establish_install = marker.telemetry_off_establish_install;
    state.pending_install_token = None;
    state.activity_secret = None;
}

pub(super) fn write_disabled_marker(path: &Path, state: &CounterState) -> Result<(), String> {
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
    let marker = DisabledMarker {
        schema: 1,
        install_token: state.install_token.clone(),
        preference_generation: state.preference_generation,
        telemetry_off_pending: state.telemetry_off_pending,
        telemetry_off_establish_install: state.telemetry_off_establish_install,
    };
    let contents = serde_json::to_vec(&marker)
        .map_err(|error| format!("failed to serialize counter opt-out marker: {error}"))?;
    file.write_all(&contents)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("failed to persist counter opt-out marker: {error}"))
}
