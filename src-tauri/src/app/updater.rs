use tauri_plugin_updater::UpdaterExt;

use crate::app::constants::APP_UPDATE_TIMEOUT_SECS;
use crate::app::state::{AppUpdateInstallResult, AppUpdateStatus, PendingAppUpdate};

#[tauri::command]
pub async fn check_for_app_update(
    app: tauri::AppHandle,
    pending_update: tauri::State<'_, PendingAppUpdate>,
) -> Result<AppUpdateStatus, String> {
    let updater = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(APP_UPDATE_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;
    let current_version = app.package_info().version.to_string();
    let update = updater.check().await.map_err(|error| error.to_string())?;

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
    pending_update: tauri::State<'_, PendingAppUpdate>,
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
