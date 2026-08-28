//! Dedicated embedded playback WebView lifecycle.
//!
//! Tauri 2.11.5 gates multi-WebView native windows behind its `unstable`
//! feature. The underlying child-WebView implementation is desktop-only:
//! WKWebView on macOS, WebView2 on Windows, and WebKitGTK on Linux. Creation is
//! an async command because Tauri documents a WebView2 deadlock when child
//! WebViews are created from synchronous commands or event handlers.

mod activation;
mod commands;
mod creation;
mod geometry;
mod messages;
mod native_loss;
mod protocol;
mod registry;
mod source;

pub use protocol::serve_render_surface_protocol;
pub use registry::RenderSurfaceManager;
pub use source::CreateRenderSurfaceRequest;

pub(crate) use commands::{cleanup_render_surface_cache_on_startup, close_all_render_surfaces};

use tauri::{AppHandle, State};

pub const RENDER_SURFACE_PROTOCOL: &str = "rav-render";

pub(super) const MAIN_WINDOW_LABEL: &str = "main";
pub(super) const RENDER_SURFACE_LABEL_PREFIX: &str = "render-surface-";
pub(super) const RENDER_SURFACE_URL: &str = "render-surface.html";
pub(super) const RENDER_SURFACE_DIRECTORY: &str = "render-surface";
pub(super) const RENDER_SURFACE_FILE_PREFIX: &str = "render-surface-";
pub(super) const RENDER_SURFACE_BRIDGE_PROBE_PATH: &str = "/__rav-render-surface-bridge";
pub(super) const RENDER_SURFACE_STARTUP_RECEIPT_PATH: &str =
    "/__rav-render-surface-startup-receipt";
pub(super) const RENDER_SURFACE_LOAD_EVENT: &str = "render-surface:load";
pub(super) const RENDER_SURFACE_COMMAND_EVENT: &str = "render-surface:command";

#[tauri::command]
pub async fn create_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
    request: CreateRenderSurfaceRequest,
) -> Result<(), String> {
    commands::create_render_surface(app, manager, request).await
}

#[tauri::command]
pub fn set_render_surface_bounds(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    commands::set_render_surface_bounds(app, manager, x, y, width, height)
}

#[tauri::command]
pub fn show_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
) -> Result<(), String> {
    commands::show_render_surface(app, manager)
}

#[tauri::command]
pub fn hide_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
) -> Result<(), String> {
    commands::hide_render_surface(app, manager)
}

#[tauri::command]
pub fn park_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
) -> Result<(), String> {
    activation::park_render_surface(app, manager)
}

#[tauri::command]
pub fn restore_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
) -> Result<(), String> {
    activation::restore_render_surface(app, manager)
}

#[tauri::command]
pub fn close_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
) -> Result<(), String> {
    commands::close_render_surface(app, manager)
}

#[tauri::command]
pub fn activate_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
    session_id: String,
    reveal: bool,
) -> Result<(), String> {
    commands::activate_render_surface(app, manager, session_id, reveal)
}

#[tauri::command]
pub fn discard_render_surface(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
    session_id: String,
) -> Result<(), String> {
    commands::discard_render_surface(app, manager, session_id)
}

#[tauri::command]
pub async fn send_render_surface_message(
    app: AppHandle,
    manager: State<'_, RenderSurfaceManager>,
    event: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    messages::send_render_surface_message(app, manager, event, payload).await
}
