mod commands;
mod manager;
mod support;
mod trace;
mod types;

pub use manager::UiOverlayManager;
pub use types::{
    ShowUiOverlayRequest, UiOverlayActionCompletionRequest, UiOverlayActionRequest,
    UiOverlayReadyRequest,
};

use tauri::{AppHandle, State};

pub(crate) use commands::close_all_ui_overlays;

#[tauri::command]
pub async fn show_ui_overlay(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    request: ShowUiOverlayRequest,
) -> Result<u64, String> {
    commands::show_ui_overlay(app, manager, request).await
}

#[tauri::command]
pub async fn restack_ui_overlay(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
) -> Result<Option<u64>, String> {
    commands::restack_ui_overlay(app, manager).await
}

#[tauri::command]
pub fn acknowledge_ui_overlay_adopted(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    epoch: u64,
) -> Result<(), String> {
    commands::acknowledge_ui_overlay_adopted(app, manager, epoch)
}

#[tauri::command]
pub fn ui_overlay_ready(
    webview: tauri::Webview,
    request: UiOverlayReadyRequest,
) -> Result<(), String> {
    commands::ui_overlay_ready(webview, request)
}

#[tauri::command]
pub fn submit_ui_overlay_action(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    webview: tauri::Webview,
    request: UiOverlayActionRequest,
) -> Result<(), String> {
    commands::submit_ui_overlay_action(app, manager, webview, request)
}

#[tauri::command]
pub fn complete_ui_overlay_action(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    webview: tauri::Webview,
    epoch: u64,
    action_id: String,
    ok: bool,
    message: String,
) -> Result<(), String> {
    commands::complete_ui_overlay_action(
        app,
        manager,
        webview,
        UiOverlayActionCompletionRequest {
            epoch,
            action_id,
            ok,
            message,
        },
    )
}

#[tauri::command]
pub fn is_ui_overlay_supported(app: AppHandle) -> bool {
    support::is_ui_overlay_supported(app)
}

#[tauri::command]
pub fn update_ui_overlay_state(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    epoch: u64,
    state: serde_json::Value,
) -> Result<(), String> {
    commands::update_ui_overlay_state(app, manager, epoch, state)
}

#[tauri::command]
pub fn close_ui_overlay(
    app: AppHandle,
    manager: State<'_, UiOverlayManager>,
    expected_epoch: Option<u64>,
) -> Result<(), String> {
    commands::close_ui_overlay(app, manager, expected_epoch)
}
