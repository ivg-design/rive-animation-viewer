use std::path::{Path, PathBuf};

use crate::app::constants::is_official_app_identifier;

mod bundle;
mod commands;
#[cfg(target_os = "macos")]
mod handlers;
#[cfg(target_os = "macos")]
mod registration;

pub(super) const CANONICAL_RIV_UTI: &str = "app.rive.editor.rive-file";
pub(super) const LEGACY_RAV_RIV_UTI: &str = "app.rive.animation.viewer.riv";
pub(super) const RIVIEW_RIV_UTI: &str = "app.rive.riv";
pub(super) const PLAY_RIV_UTI: &str = "com.play.riv";
pub(super) const KNOWN_RIV_UTIS: [&str; 4] = [
    CANONICAL_RIV_UTI,
    RIVIEW_RIV_UTI,
    PLAY_RIV_UTI,
    LEGACY_RAV_RIV_UTI,
];

const DOCUMENT_TYPE_REGISTRATION_REVISION: &str = "riv-uti-v4";
const DOCUMENT_TYPE_REGISTRATION_MARKER: &str = "launch-services-registration-version";

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RivContentTypeHandlerStatus {
    pub content_type: String,
    pub handler_path: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RivDefaultAppStatus {
    pub available: bool,
    pub state: String,
    pub handler_name: Option<String>,
    pub reason: Option<String>,
    pub resolved_content_type: Option<String>,
    pub resolved_handler_path: Option<String>,
    pub canonical_handler_path: Option<String>,
    pub riview_handler_path: Option<String>,
    pub play_handler_path: Option<String>,
    pub legacy_handler_path: Option<String>,
    pub content_type_handlers: Vec<RivContentTypeHandlerStatus>,
    pub current_bundle_path: Option<String>,
}

impl RivDefaultAppStatus {
    pub(super) fn unavailable(reason: impl Into<String>, current_bundle: Option<&Path>) -> Self {
        Self {
            available: false,
            state: "unavailable".into(),
            handler_name: None,
            reason: Some(reason.into()),
            resolved_content_type: None,
            resolved_handler_path: None,
            canonical_handler_path: None,
            riview_handler_path: None,
            play_handler_path: None,
            legacy_handler_path: None,
            content_type_handlers: Vec::new(),
            current_bundle_path: current_bundle.map(path_string),
        }
    }
}

pub(super) fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// Returns the enclosing `.app` bundle for a macOS app executable.
///
/// Development binaries are intentionally rejected: Launch Services should only
/// be refreshed for a shipped bundle whose Info.plist is actually registered.
pub(crate) fn app_bundle_path_from_executable(executable: &Path) -> Option<PathBuf> {
    let macos_dir = executable.parent()?;
    if macos_dir.file_name()?.to_str()? != "MacOS" {
        return None;
    }
    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()?.to_str()? != "Contents" {
        return None;
    }
    let bundle = contents_dir.parent()?;
    if bundle.extension()?.to_str()? != "app" {
        return None;
    }
    Some(bundle.to_path_buf())
}

pub(crate) fn startup_registration_allowed(
    identifier: &str,
    updater_acceptance_enabled: bool,
    telemetry_acceptance_enabled: bool,
) -> bool {
    is_official_app_identifier(identifier)
        && !updater_acceptance_enabled
        && !telemetry_acceptance_enabled
}

pub(crate) fn registration_needed(
    marker_contents: Option<&str>,
    package_version: &str,
    bundle: &Path,
) -> bool {
    marker_contents
        .map(|contents| contents.trim() != registration_marker(package_version, bundle))
        .unwrap_or(true)
}

fn registration_marker(package_version: &str, bundle: &Path) -> String {
    format!(
        "{package_version}:{DOCUMENT_TYPE_REGISTRATION_REVISION}:{}",
        bundle.display()
    )
}

/// Re-register the official production bundle once per package version,
/// document-type schema revision, and canonical bundle path.
///
/// This refreshes Finder's document metadata only. Default-handler ownership
/// remains exclusive to the explicit Settings action.
pub fn refresh_for_installed_version(
    app: &tauri::AppHandle,
    updater_acceptance_enabled: bool,
    telemetry_acceptance_enabled: bool,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            app,
            updater_acceptance_enabled,
            telemetry_acceptance_enabled,
        );
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        use std::fs;
        use tauri::Manager;

        if !startup_registration_allowed(
            &app.config().identifier,
            updater_acceptance_enabled,
            telemetry_acceptance_enabled,
        ) {
            return Ok(());
        }

        let executable = std::env::current_exe()
            .map_err(|error| format!("failed to resolve app executable: {error}"))?;
        let Some(bundle) = app_bundle_path_from_executable(&executable) else {
            // `cargo tauri dev` and test binaries are not installed bundles.
            return Ok(());
        };
        if !bundle.join("Contents/Info.plist").is_file() {
            return Ok(());
        }
        let canonical_bundle = fs::canonicalize(&bundle).unwrap_or(bundle);

        let version = app.package_info().version.to_string();
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
        let marker = data_dir.join(DOCUMENT_TYPE_REGISTRATION_MARKER);
        let marker_contents = fs::read_to_string(&marker).ok();
        if !registration_needed(marker_contents.as_deref(), &version, &canonical_bundle) {
            return Ok(());
        }

        registration::register_bundle(&canonical_bundle)?;

        fs::create_dir_all(&data_dir)
            .map_err(|error| format!("failed to create app data directory: {error}"))?;
        let temporary_marker = data_dir.join(format!(
            "{DOCUMENT_TYPE_REGISTRATION_MARKER}.{}.tmp",
            std::process::id()
        ));
        fs::write(
            &temporary_marker,
            format!("{}\n", registration_marker(&version, &canonical_bundle)),
        )
        .map_err(|error| format!("failed to write Launch Services marker: {error}"))?;
        fs::rename(&temporary_marker, &marker)
            .map_err(|error| format!("failed to commit Launch Services marker: {error}"))?;
        Ok(())
    }
}

#[tauri::command]
pub async fn get_riv_default_app_status(app: tauri::AppHandle) -> RivDefaultAppStatus {
    commands::get_riv_default_app_status(app).await
}

#[tauri::command]
pub async fn make_rav_default_for_riv(app: tauri::AppHandle) -> RivDefaultAppStatus {
    commands::make_rav_default_for_riv(app).await
}

#[cfg(test)]
mod tests;
