use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Url;
use tauri_plugin_updater::UpdaterExt;

use crate::app::constants::APP_UPDATE_TIMEOUT_SECS;
use crate::app::mcp::bridge::kill_spawned_mcp_bridge;
use crate::app::state::{
    AppUpdateInstallResult, AppUpdateStatus, McpBridgeManager, PendingAppUpdate,
};

const ACCEPTANCE_ENABLED_ENV: &str = "RAV_UPDATER_ACCEPTANCE";
const ACCEPTANCE_ENDPOINT_ENV: &str = "RAV_UPDATER_ACCEPTANCE_ENDPOINT";
const ACCEPTANCE_ROOT_ENV: &str = "RAV_UPDATER_ACCEPTANCE_ROOT";
const ACCEPTANCE_AUTO_INSTALL_ENV: &str = "RAV_UPDATER_ACCEPTANCE_AUTO_INSTALL";

#[derive(Clone, Debug)]
pub struct UpdaterAcceptance {
    config: Option<UpdaterAcceptanceConfig>,
}

#[derive(Clone, Debug)]
struct UpdaterAcceptanceConfig {
    endpoint: Url,
    root: PathBuf,
    auto_install: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterAcceptanceStatus {
    enabled: bool,
    auto_install: bool,
}

impl UpdaterAcceptance {
    pub fn from_process_env() -> Result<Self, String> {
        Self::from_values(
            std::env::var(ACCEPTANCE_ENABLED_ENV).ok().as_deref(),
            std::env::var(ACCEPTANCE_ENDPOINT_ENV).ok().as_deref(),
            std::env::var(ACCEPTANCE_ROOT_ENV).ok().as_deref(),
            std::env::var(ACCEPTANCE_AUTO_INSTALL_ENV).ok().as_deref(),
            &std::env::temp_dir(),
        )
    }

    fn from_values(
        enabled: Option<&str>,
        endpoint: Option<&str>,
        root: Option<&str>,
        auto_install: Option<&str>,
        process_temp_dir: &Path,
    ) -> Result<Self, String> {
        if enabled.is_none() && endpoint.is_none() && root.is_none() && auto_install.is_none() {
            return Ok(Self { config: None });
        }
        if enabled != Some("1") {
            return Err(format!(
                "{ACCEPTANCE_ENABLED_ENV}=1 is required when updater acceptance variables are set"
            ));
        }

        let endpoint = Url::parse(endpoint.ok_or_else(|| {
            format!("{ACCEPTANCE_ENDPOINT_ENV} is required in updater acceptance mode")
        })?)
        .map_err(|error| format!("invalid {ACCEPTANCE_ENDPOINT_ENV}: {error}"))?;
        validate_loopback_endpoint(&endpoint)?;

        let root = PathBuf::from(root.ok_or_else(|| {
            format!("{ACCEPTANCE_ROOT_ENV} is required in updater acceptance mode")
        })?);
        if !root.is_absolute() {
            return Err(format!("{ACCEPTANCE_ROOT_ENV} must be absolute"));
        }
        let canonical_root = std::fs::canonicalize(&root)
            .map_err(|error| format!("invalid {ACCEPTANCE_ROOT_ENV}: {error}"))?;
        let canonical_temp = std::fs::canonicalize(process_temp_dir)
            .map_err(|error| format!("invalid process temp directory: {error}"))?;
        if canonical_root != canonical_temp {
            return Err(format!(
                "{ACCEPTANCE_ROOT_ENV} must be the isolated process temp directory"
            ));
        }

        let auto_install = match auto_install {
            None => false,
            Some("1") => true,
            Some(_) => {
                return Err(format!(
                    "{ACCEPTANCE_AUTO_INSTALL_ENV} must be 1 when provided"
                ))
            }
        };

        Ok(Self {
            config: Some(UpdaterAcceptanceConfig {
                endpoint,
                root: canonical_root,
                auto_install,
            }),
        })
    }

    pub fn is_enabled(&self) -> bool {
        self.config.is_some()
    }

    pub fn status(&self) -> UpdaterAcceptanceStatus {
        UpdaterAcceptanceStatus {
            enabled: self.is_enabled(),
            auto_install: self
                .config
                .as_ref()
                .is_some_and(|config| config.auto_install),
        }
    }

    pub fn write_launch_marker(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let Some(config) = self.config.as_ref() else {
            return Ok(());
        };
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let marker = serde_json::json!({
            "schemaVersion": 1,
            "kind": "rav-updater-acceptance-launch",
            "version": app.package_info().version.to_string(),
            "pid": std::process::id(),
            "executable": executable,
        });
        let marker_path = config
            .root
            .join(format!("rav-launch-{}.json", std::process::id()));
        let temporary_path = marker_path.with_extension("json.tmp");
        std::fs::write(
            &temporary_path,
            serde_json::to_vec_pretty(&marker).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        std::fs::rename(temporary_path, marker_path).map_err(|error| error.to_string())
    }

    fn endpoint(&self) -> Option<Url> {
        self.config.as_ref().map(|config| config.endpoint.clone())
    }
}

fn validate_loopback_endpoint(endpoint: &Url) -> Result<(), String> {
    if !matches!(endpoint.scheme(), "http" | "https") {
        return Err("updater acceptance endpoint must use HTTP or HTTPS".to_string());
    }
    if !endpoint.username().is_empty() || endpoint.password().is_some() {
        return Err("updater acceptance endpoint must not contain credentials".to_string());
    }
    if endpoint.port().is_none() {
        return Err("updater acceptance endpoint must use an explicit port".to_string());
    }
    if !matches!(endpoint.host_str(), Some("127.0.0.1") | Some("::1")) {
        return Err("updater acceptance endpoint must use a loopback IP literal".to_string());
    }
    if endpoint.query().is_some() || endpoint.fragment().is_some() {
        return Err("updater acceptance endpoint must not contain a query or fragment".to_string());
    }
    if !endpoint.path().ends_with("/latest.json") {
        return Err("updater acceptance endpoint must end in /latest.json".to_string());
    }
    Ok(())
}

fn map_updater_error(
    acceptance: &UpdaterAcceptance,
    stage: &str,
    error: impl std::fmt::Display,
) -> String {
    let message = error.to_string();
    if acceptance.is_enabled() {
        eprintln!("[rav-updater-acceptance] {stage}: {message}");
    }
    message
}

#[tauri::command]
pub fn get_updater_acceptance_config(
    acceptance: tauri::State<'_, UpdaterAcceptance>,
) -> UpdaterAcceptanceStatus {
    acceptance.status()
}

#[tauri::command]
pub async fn check_for_app_update(
    app: tauri::AppHandle,
    acceptance: tauri::State<'_, UpdaterAcceptance>,
    pending_update: tauri::State<'_, PendingAppUpdate>,
) -> Result<AppUpdateStatus, String> {
    let mut builder = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(APP_UPDATE_TIMEOUT_SECS));
    if let Some(endpoint) = acceptance.endpoint() {
        builder = builder
            .endpoints(vec![endpoint])
            .map_err(|error| map_updater_error(&acceptance, "endpoint override failed", error))?;
    }
    let updater = builder
        .build()
        .map_err(|error| map_updater_error(&acceptance, "updater build failed", error))?;
    let current_version = app.package_info().version.to_string();
    let update = updater
        .check()
        .await
        .map_err(|error| map_updater_error(&acceptance, "update check failed", error))?;

    let mut pending_guard = pending_update.0.lock().map_err(|error| error.to_string())?;
    *pending_guard = update;

    Ok(match pending_guard.as_ref() {
        Some(update) => AppUpdateStatus {
            available: true,
            current_version,
            version: Some(update.version.clone()),
            body: update.body.clone(),
        },
        None => AppUpdateStatus {
            available: false,
            current_version,
            version: None,
            body: None,
        },
    })
}

#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    bridge_manager: tauri::State<'_, McpBridgeManager>,
    pending_update: tauri::State<'_, PendingAppUpdate>,
    acceptance: tauri::State<'_, UpdaterAcceptance>,
) -> Result<AppUpdateInstallResult, String> {
    let update = {
        let mut pending_guard = pending_update.0.lock().map_err(|error| error.to_string())?;
        pending_guard.take()
    };

    let Some(update) = update else {
        return Ok(AppUpdateInstallResult {
            installed: false,
            version: None,
        });
    };

    let version = update.version.clone();
    if !acceptance.is_enabled() {
        kill_spawned_mcp_bridge(&app, &bridge_manager);
    }

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    Ok(AppUpdateInstallResult {
        installed: true,
        version: Some(version),
    })
}

#[tauri::command]
pub fn relaunch_app(app: tauri::AppHandle) -> bool {
    app.request_restart();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acceptance_mode_is_disabled_without_environment() {
        let result = UpdaterAcceptance::from_values(None, None, None, None, Path::new("/tmp"));
        assert!(!result.unwrap().is_enabled());
    }

    #[test]
    fn acceptance_mode_accepts_only_explicit_loopback_configuration() {
        let temp = std::env::temp_dir().canonicalize().unwrap();
        let root = temp.to_string_lossy();
        let result = UpdaterAcceptance::from_values(
            Some("1"),
            Some("http://127.0.0.1:43991/token/latest.json"),
            Some(&root),
            Some("1"),
            &temp,
        )
        .unwrap();
        assert!(result.is_enabled());
        assert!(result.status().auto_install);
    }

    #[test]
    fn acceptance_mode_rejects_non_loopback_and_implicit_opt_in() {
        let temp = std::env::temp_dir().canonicalize().unwrap();
        let root = temp.to_string_lossy();
        assert!(UpdaterAcceptance::from_values(
            None,
            Some("http://127.0.0.1:43991/latest.json"),
            Some(&root),
            None,
            &temp,
        )
        .is_err());
        assert!(UpdaterAcceptance::from_values(
            Some("1"),
            Some("https://example.com:443/latest.json"),
            Some(&root),
            None,
            &temp,
        )
        .is_err());
    }

    #[test]
    fn acceptance_mode_rejects_unsafe_endpoint_shapes() {
        for endpoint in [
            "file:///tmp/latest.json",
            "http://localhost:43991/latest.json",
            "http://127.0.0.1/latest.json",
            "http://user@127.0.0.1:43991/latest.json",
            "http://127.0.0.1:43991/latest.json?x=1",
            "http://127.0.0.1:43991/manifest",
        ] {
            let parsed = Url::parse(endpoint).unwrap();
            assert!(validate_loopback_endpoint(&parsed).is_err(), "{endpoint}");
        }
    }
}
