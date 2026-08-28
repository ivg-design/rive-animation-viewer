use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

use crate::app::install_counter::{telemetry_acceptance_enabled, TELEMETRY_ACCEPTANCE_IDENTIFIER};

const ACTION_ENV: &str = "RAV_TELEMETRY_ACCEPTANCE_ACTION";
const ROOT_ENV: &str = "RAV_TELEMETRY_ACCEPTANCE_ROOT";
const COMPLETION_FILE: &str = "rav-telemetry-acceptance-result.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TelemetryAcceptanceAction {
    Acknowledge,
    Enable,
    Disable,
}

impl TelemetryAcceptanceAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Acknowledge => "acknowledge",
            Self::Enable => "enable",
            Self::Disable => "disable",
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "acknowledge" => Ok(Self::Acknowledge),
            "enable" => Ok(Self::Enable),
            "disable" => Ok(Self::Disable),
            _ => Err(format!(
                "{ACTION_ENV} must be acknowledge, enable, or disable when provided"
            )),
        }
    }
}

#[derive(Debug)]
pub struct TelemetryAcceptanceDriver {
    action: Option<TelemetryAcceptanceAction>,
    completion_root: Option<PathBuf>,
    completed: AtomicBool,
}

/// Telemetry acceptance is intentionally background-only so a running DEV
/// instance remains the user's active window.
pub fn should_focus_main_window(telemetry_acceptance_enabled: bool) -> bool {
    !telemetry_acceptance_enabled
}

impl Default for TelemetryAcceptanceDriver {
    fn default() -> Self {
        Self {
            action: None,
            completion_root: None,
            completed: AtomicBool::new(false),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompletionMarker<'a> {
    schema_version: u8,
    kind: &'static str,
    app_identifier: &'a str,
    pid: u32,
    action: &'a str,
    succeeded: bool,
    enabled: bool,
}

impl TelemetryAcceptanceDriver {
    pub fn from_process_env() -> Result<Self, String> {
        if !telemetry_acceptance_enabled() {
            return Ok(Self::default());
        }
        Self::from_values(
            std::env::var(ACTION_ENV).ok().as_deref(),
            std::env::var(ROOT_ENV).ok().as_deref(),
            &std::env::temp_dir(),
        )
    }

    fn from_values(
        action: Option<&str>,
        root: Option<&str>,
        process_temp_dir: &Path,
    ) -> Result<Self, String> {
        match (action, root) {
            (None, None) => Ok(Self::default()),
            (None, Some(_)) => Err(format!("{ACTION_ENV} is required when {ROOT_ENV} is set")),
            (Some(_), None) => Err(format!("{ROOT_ENV} is required when {ACTION_ENV} is set")),
            (Some(action), Some(root)) => Ok(Self {
                action: Some(TelemetryAcceptanceAction::parse(action)?),
                completion_root: Some(validate_completion_root(root, process_temp_dir)?),
                completed: AtomicBool::new(false),
            }),
        }
    }

    pub fn initialization_script(&self) -> &'static str {
        match self.action {
            Some(TelemetryAcceptanceAction::Acknowledge) => {
                "window.__RAV_TELEMETRY_ACCEPTANCE__ = true; window.__RAV_ISOLATED_DEV__ = true; window.__RAV_TELEMETRY_ACCEPTANCE_ACTION__ = 'acknowledge';"
            }
            Some(TelemetryAcceptanceAction::Enable) => {
                "window.__RAV_TELEMETRY_ACCEPTANCE__ = true; window.__RAV_ISOLATED_DEV__ = true; window.__RAV_TELEMETRY_ACCEPTANCE_ACTION__ = 'enable';"
            }
            Some(TelemetryAcceptanceAction::Disable) => {
                "window.__RAV_TELEMETRY_ACCEPTANCE__ = true; window.__RAV_ISOLATED_DEV__ = true; window.__RAV_TELEMETRY_ACCEPTANCE_ACTION__ = 'disable';"
            }
            None => {
                "window.__RAV_TELEMETRY_ACCEPTANCE__ = true; window.__RAV_ISOLATED_DEV__ = true;"
            }
        }
    }

    fn complete(
        &self,
        app: &tauri::AppHandle,
        action: &str,
        succeeded: bool,
        enabled: bool,
    ) -> Result<(), String> {
        if !telemetry_acceptance_enabled()
            || app.config().identifier != TELEMETRY_ACCEPTANCE_IDENTIFIER
        {
            return Err("telemetry acceptance action completion is unavailable in this app".into());
        }
        let expected_action = self
            .action
            .ok_or_else(|| "no telemetry acceptance action was requested".to_string())?;
        if action != expected_action.as_str() {
            return Err("telemetry acceptance action does not match the launch request".into());
        }
        if self.completed.swap(true, Ordering::AcqRel) {
            return Err("telemetry acceptance action was already completed".into());
        }
        let root = self
            .completion_root
            .as_ref()
            .ok_or_else(|| "telemetry acceptance completion root is unavailable".to_string())?;
        write_completion_marker(
            root,
            &CompletionMarker {
                schema_version: 1,
                kind: "rav-telemetry-acceptance-result",
                app_identifier: &app.config().identifier,
                pid: std::process::id(),
                action,
                succeeded,
                enabled,
            },
        )
    }
}

#[tauri::command]
pub fn complete_telemetry_acceptance_action(
    app: tauri::AppHandle,
    driver: tauri::State<'_, TelemetryAcceptanceDriver>,
    action: String,
    succeeded: bool,
    enabled: bool,
) -> Result<(), String> {
    driver.complete(&app, &action, succeeded, enabled)
}

fn validate_completion_root(value: &str, process_temp_dir: &Path) -> Result<PathBuf, String> {
    let root = PathBuf::from(value);
    if !root.is_absolute() {
        return Err(format!("{ROOT_ENV} must be absolute"));
    }
    let canonical_root =
        std::fs::canonicalize(&root).map_err(|error| format!("invalid {ROOT_ENV}: {error}"))?;
    let canonical_temp = std::fs::canonicalize(process_temp_dir)
        .map_err(|error| format!("invalid process temp directory: {error}"))?;
    if canonical_root == canonical_temp || !canonical_root.starts_with(&canonical_temp) {
        return Err(format!(
            "{ROOT_ENV} must be a dedicated directory under the process temp directory"
        ));
    }
    Ok(canonical_root)
}

fn write_completion_marker(root: &Path, marker: &CompletionMarker<'_>) -> Result<(), String> {
    let output = root.join(COMPLETION_FILE);
    if output.exists() {
        return Err("telemetry acceptance completion marker already exists".into());
    }
    let temporary = root.join(format!(".{COMPLETION_FILE}.{}.tmp", std::process::id()));
    let contents = serde_json::to_vec_pretty(marker).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(&contents)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    std::fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    std::fs::rename(temporary, output).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_three_explicit_actions() {
        assert_eq!(
            TelemetryAcceptanceAction::parse("acknowledge"),
            Ok(TelemetryAcceptanceAction::Acknowledge)
        );
        assert_eq!(
            TelemetryAcceptanceAction::parse("enable"),
            Ok(TelemetryAcceptanceAction::Enable)
        );
        assert_eq!(
            TelemetryAcceptanceAction::parse("disable"),
            Ok(TelemetryAcceptanceAction::Disable)
        );
        assert!(TelemetryAcceptanceAction::parse("on").is_err());
        assert!(TelemetryAcceptanceAction::parse("").is_err());
    }

    #[test]
    fn action_requires_a_dedicated_temp_root() {
        let root =
            std::env::temp_dir().join(format!("rav-telemetry-driver-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        assert!(TelemetryAcceptanceDriver::from_values(
            Some("enable"),
            Some(root.to_str().unwrap()),
            &std::env::temp_dir()
        )
        .is_ok());
        assert!(TelemetryAcceptanceDriver::from_values(
            Some("enable"),
            None,
            &std::env::temp_dir()
        )
        .is_err());
        assert!(TelemetryAcceptanceDriver::from_values(
            None,
            Some(root.to_str().unwrap()),
            &std::env::temp_dir()
        )
        .is_err());
        assert!(TelemetryAcceptanceDriver::from_values(
            Some("invalid"),
            Some(root.to_str().unwrap()),
            &std::env::temp_dir()
        )
        .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn completion_marker_is_bounded_and_never_overwrites() {
        let root =
            std::env::temp_dir().join(format!("rav-telemetry-marker-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let marker = CompletionMarker {
            schema_version: 1,
            kind: "rav-telemetry-acceptance-result",
            app_identifier: TELEMETRY_ACCEPTANCE_IDENTIFIER,
            pid: 123,
            action: "enable",
            succeeded: true,
            enabled: true,
        };
        write_completion_marker(&root, &marker).unwrap();
        let output = std::fs::read_to_string(root.join(COMPLETION_FILE)).unwrap();
        assert!(output.contains("\"action\": \"enable\""));
        assert!(write_completion_marker(&root, &marker).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn telemetry_acceptance_never_steals_focus_from_an_active_dev_window() {
        assert!(!should_focus_main_window(true));
        assert!(should_focus_main_window(false));
    }
}
