use reqwest::Url;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::Manager;

use self::protocol::validate_endpoint;
#[cfg(test)]
use self::protocol::{utc_month, CounterPayload};
#[cfg(test)]
use self::reporting_cycle::build_counter_client;
use self::reporting_cycle::{
    report_telemetry_off_if_needed, reporting_work_is_pending, schedule_report_cycle,
    LAUNCH_INSTALL_DELAY,
};
use self::state::{
    apply_enabled, ensure_state, prepare_telemetry_off_receipt, read_state, state_path,
    write_state, CounterState,
};
#[cfg(test)]
use self::state::{
    pending_telemetry_off, record_install_success, record_monthly_active_success,
    record_telemetry_off_success,
};

mod protocol;
mod reporting_cycle;
mod state;
pub mod telemetry_acceptance;
#[cfg(test)]
mod tests;

const COUNTER_SCHEMA: u8 = 2;
const NOTICE_VERSION: u16 = 1;
pub const TELEMETRY_ACCEPTANCE_IDENTIFIER: &str = "app.rive.animation.viewer.telemetry-acceptance";

#[derive(Default)]
pub struct InstallCounterManager {
    state_lock: Mutex<()>,
    reporting: AtomicBool,
    telemetry_off_reporting: AtomicBool,
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
    configured_endpoint_from_values(
        cfg!(debug_assertions),
        option_env!("RAV_OFFICIAL_RELEASE"),
        option_env!("RAV_COUNTER_ENDPOINT"),
        option_env!("RAV_TELEMETRY_ACCEPTANCE_BUILD"),
        option_env!("RAV_TELEMETRY_ACCEPTANCE_BUILD_ENDPOINT"),
    )
}

/// This is intentionally compile-time only: a normal DEV build cannot be
/// pointed at an endpoint through its launch environment. Acceptance builds
/// use an explicitly separate endpoint compiled by `build.rs`.
pub fn telemetry_acceptance_enabled() -> bool {
    telemetry_acceptance_enabled_from_values(
        cfg!(debug_assertions),
        option_env!("RAV_OFFICIAL_RELEASE"),
        option_env!("RAV_TELEMETRY_ACCEPTANCE_BUILD"),
    )
}

/// Refuse a telemetry-marked binary that was bundled with any normal RAV
/// identifier. This runs during setup before the counter can create state or
/// send a request, keeping acceptance data isolated from both release and DEV
/// app-data directories.
pub fn validate_telemetry_acceptance_identifier(identifier: &str) -> Result<(), String> {
    if !telemetry_acceptance_identifier_is_valid(telemetry_acceptance_enabled(), identifier) {
        return Err(format!(
            "telemetry acceptance requires app identifier {TELEMETRY_ACCEPTANCE_IDENTIFIER}, got {identifier}"
        ));
    }
    Ok(())
}

fn telemetry_acceptance_identifier_is_valid(
    telemetry_acceptance_enabled: bool,
    identifier: &str,
) -> bool {
    !telemetry_acceptance_enabled || identifier == TELEMETRY_ACCEPTANCE_IDENTIFIER
}

fn telemetry_acceptance_enabled_from_values(
    debug_assertions: bool,
    official_release: Option<&str>,
    acceptance_build: Option<&str>,
) -> bool {
    !debug_assertions && official_release != Some("1") && acceptance_build == Some("1")
}

fn configured_endpoint_from_values(
    debug_assertions: bool,
    official_release: Option<&str>,
    official_endpoint: Option<&str>,
    acceptance_build: Option<&str>,
    acceptance_endpoint: Option<&str>,
) -> Option<Url> {
    if debug_assertions {
        return None;
    }
    if official_release == Some("1") {
        return official_endpoint.and_then(|value| validate_endpoint(value).ok());
    }
    if telemetry_acceptance_enabled_from_values(
        debug_assertions,
        official_release,
        acceptance_build,
    ) {
        return acceptance_endpoint.and_then(|value| validate_endpoint(value).ok());
    }
    None
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

fn state_for_status(path: &Path, endpoint_available: bool) -> Result<CounterState, String> {
    if endpoint_available {
        ensure_state(path, true)
    } else {
        Ok(read_state(path))
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
    let path = state_path(&app)?;
    // An unavailable/dev build must be observational only. In particular, it
    // must not create the durable opt-out marker just because this build has
    // no endpoint; that would silently carry into an official build sharing
    // the same app-data directory.
    let state = state_for_status(&path, configured_endpoint().is_some())?;
    Ok(status_from_state(&state))
}

#[tauri::command]
pub async fn set_install_counter_enabled(
    app: tauri::AppHandle,
    manager: tauri::State<'_, InstallCounterManager>,
    enabled: bool,
) -> Result<InstallCounterStatus, String> {
    let endpoint = configured_endpoint();
    if endpoint.is_none() {
        if enabled {
            return Err(
                "anonymous installation counting is not configured in this build".to_string(),
            );
        }
        let _guard = manager
            .state_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let path = state_path(&app)?;
        return Ok(status_from_state(&read_state(&path)));
    }
    let (mut status, telemetry_off_requested) = {
        let _guard = manager
            .state_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let path = state_path(&app)?;
        let mut state = ensure_state(&path, configured_endpoint().is_some())?;
        let was_enabled = state.enabled;
        apply_enabled(&mut state, enabled);
        let telemetry_off_requested = !enabled
            && was_enabled
            && endpoint.is_some()
            && prepare_telemetry_off_receipt(&mut state).is_some();
        if enabled {
            state.notice_version = NOTICE_VERSION;
        }
        write_state(&path, &state)?;
        (status_from_state(&state), telemetry_off_requested)
    };
    if let (Some(endpoint), true) = (endpoint.as_ref(), telemetry_off_requested) {
        if let Err(error) = report_telemetry_off_if_needed(&app, endpoint).await {
            eprintln!("[rav-counter] telemetry-off receipt was not delivered: {error}");
            // One bounded retry is queued. If it also fails, the durable
            // pending receipt is retried once on each later app launch.
            schedule_report_cycle(&app, LAUNCH_INSTALL_DELAY);
        }
        if let Ok(_guard) = manager.state_lock.lock() {
            if let Ok(path) = state_path(&app) {
                status = status_from_state(&read_state(&path));
            }
        }
    }
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
    if configured_endpoint().is_none() {
        return Ok(status_from_state(&read_state(&state_path(&app)?)));
    }
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
        .is_some_and(|state| reporting_work_is_pending(&state, SystemTime::now()));
    if ready {
        schedule_report_cycle(app, LAUNCH_INSTALL_DELAY);
    }
}
