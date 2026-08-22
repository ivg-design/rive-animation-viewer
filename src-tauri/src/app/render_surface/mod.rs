//! Dedicated embedded playback WebView lifecycle.
//!
//! Tauri 2.11.5 gates multi-WebView native windows behind its `unstable`
//! feature. The underlying child-WebView implementation is desktop-only:
//! WKWebView on macOS, WebView2 on Windows, and WebKitGTK on Linux. Creation is
//! an async command because Tauri documents a WebView2 deadlock when child
//! WebViews are created from synchronous commands or event handlers.

use std::path::{Component, Path};

use serde::Deserialize;
use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position,
    Rect, Size, Url, WebviewUrl,
};

use crate::app::{demo_bundle::write_demo_html_atomically, state::DemoBundlePayload};

mod protocol;
pub use protocol::serve_render_surface_protocol;

const MAIN_WINDOW_LABEL: &str = "main";
const RENDER_SURFACE_LABEL: &str = "render-surface";
const RENDER_SURFACE_URL: &str = "render-surface.html";
const RENDER_SURFACE_DIRECTORY: &str = "render-surface";
const RENDER_SURFACE_FILE_NAME: &str = "current-demo.html";
pub const RENDER_SURFACE_PROTOCOL: &str = "rav-render";
const RENDER_SURFACE_LOAD_EVENT: &str = "render-surface:load";
const RENDER_SURFACE_COMMAND_EVENT: &str = "render-surface:command";

#[derive(Clone, Copy, Debug, PartialEq)]
struct RenderSurfaceBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRenderSurfaceRequest {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    url: Option<String>,
    html_path: Option<String>,
    payload: Option<DemoBundlePayload>,
    session_id: Option<String>,
}

impl RenderSurfaceBounds {
    fn new(x: f64, y: f64, width: f64, height: f64) -> Result<Self, String> {
        if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
            return Err("Render surface bounds must contain finite numbers".to_string());
        }
        if width <= 0.0 || height <= 0.0 {
            return Err("Render surface width and height must be greater than zero".to_string());
        }
        Ok(Self {
            x,
            y,
            width,
            height,
        })
    }

    fn position(self) -> LogicalPosition<f64> {
        LogicalPosition::new(self.x, self.y)
    }

    fn size(self) -> LogicalSize<f64> {
        LogicalSize::new(self.width, self.height)
    }

    fn rect(self) -> Rect {
        Rect {
            position: Position::Logical(self.position()),
            size: Size::Logical(self.size()),
        }
    }
}

/// Creates the opaque child WebView, or updates and shows the existing child.
/// Coordinates and dimensions are logical pixels relative to the main native
/// window's content area.
#[tauri::command]
pub async fn create_render_surface(
    app: AppHandle,
    request: CreateRenderSurfaceRequest,
) -> Result<(), String> {
    let bounds = RenderSurfaceBounds::new(request.x, request.y, request.width, request.height)?;
    let replace_existing =
        request.url.is_some() || request.html_path.is_some() || request.payload.is_some();
    let webview_url = resolve_render_surface_url(
        &app,
        request.url.as_deref(),
        request.html_path.as_deref(),
        request.payload.as_ref(),
        request.session_id.as_deref(),
    )?;

    if let Some(webview) = app.get_webview(RENDER_SURFACE_LABEL) {
        if replace_existing {
            webview
                .hide()
                .map_err(|error| format!("Failed to hide render surface before reload: {error}"))?;
            webview
                .set_bounds(bounds.rect())
                .map_err(|error| format!("Failed to resize render surface: {error}"))?;
            if let Some(navigation_url) = navigable_url(&webview_url) {
                webview
                    .navigate(navigation_url)
                    .map_err(|error| format!("Failed to reload render surface: {error}"))?;
                return Ok(());
            }
            webview
                .close()
                .map_err(|error| format!("Failed to replace render surface: {error}"))?;
        } else {
            webview
                .set_bounds(bounds.rect())
                .map_err(|error| format!("Failed to resize render surface: {error}"))?;
            webview
                .show()
                .map_err(|error| format!("Failed to show render surface: {error}"))?;
            return Ok(());
        }
    }

    let main_window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main native window is not available".to_string())?;

    // WebviewAttributes defaults to transparent=false in Tauri 2.11.5. The
    // explicit `transparent(false)` builder method is unavailable on macOS
    // without the private-API feature, which this project intentionally avoids.
    let builder = WebviewBuilder::new(RENDER_SURFACE_LABEL, webview_url).focused(false);

    let webview = main_window
        .add_child(builder, bounds.position(), bounds.size())
        .map_err(|error| format!("Failed to create render surface: {error}"))?;
    webview
        .hide()
        .map_err(|error| format!("Failed to stage hidden render surface: {error}"))?;

    Ok(())
}

#[tauri::command]
pub fn set_render_surface_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let bounds = RenderSurfaceBounds::new(x, y, width, height)?;
    render_surface(&app)?
        .set_bounds(bounds.rect())
        .map_err(|error| format!("Failed to resize render surface: {error}"))
}

#[tauri::command]
pub fn show_render_surface(app: AppHandle) -> Result<(), String> {
    render_surface(&app)?
        .show()
        .map_err(|error| format!("Failed to show render surface: {error}"))
}

#[tauri::command]
pub fn hide_render_surface(app: AppHandle) -> Result<(), String> {
    render_surface(&app)?
        .hide()
        .map_err(|error| format!("Failed to hide render surface: {error}"))
}

#[tauri::command]
pub fn close_render_surface(app: AppHandle) -> Result<(), String> {
    render_surface(&app)?
        .close()
        .map_err(|error| format!("Failed to close render surface: {error}"))
}

/// Sends only the two coarse, host-to-renderer messages supported by the
/// dedicated playback protocol. Keeping this allowlist in Rust prevents this
/// command from becoming a generic cross-WebView event relay.
#[tauri::command]
pub async fn send_render_surface_message(
    app: AppHandle,
    event: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    if !is_allowed_render_surface_event(&event) {
        return Err(format!("Unsupported render surface event: {event}"));
    }
    render_surface(&app)?;
    app.emit_to(RENDER_SURFACE_LABEL, &event, payload)
        .map_err(|error| format!("Failed to send render surface message: {error}"))
}

fn render_surface(app: &AppHandle) -> Result<tauri::Webview, String> {
    app.get_webview(RENDER_SURFACE_LABEL)
        .ok_or_else(|| "Render surface has not been created".to_string())
}

fn is_allowed_render_surface_event(event: &str) -> bool {
    matches!(
        event,
        RENDER_SURFACE_LOAD_EVENT | RENDER_SURFACE_COMMAND_EVENT
    )
}

fn resolve_render_surface_url(
    app: &AppHandle,
    url: Option<&str>,
    html_path: Option<&str>,
    payload: Option<&DemoBundlePayload>,
    session_id: Option<&str>,
) -> Result<WebviewUrl, String> {
    let source_count = usize::from(url.is_some())
        + usize::from(html_path.is_some())
        + usize::from(payload.is_some());
    if source_count > 1 {
        return Err("Provide only one of payload, url, or htmlPath".to_string());
    }

    if let Some(payload) = payload {
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("Failed to resolve RAV cache directory: {error}"))?;
        let html_path = cache_dir
            .join(RENDER_SURFACE_DIRECTORY)
            .join(RENDER_SURFACE_FILE_NAME);
        let html_path = write_demo_html_atomically(payload, &html_path)?;
        debug_assert_eq!(
            html_path.file_name().and_then(|value| value.to_str()),
            Some(RENDER_SURFACE_FILE_NAME)
        );
        return render_surface_protocol_url(session_id);
    }

    if let Some(html_path) = html_path {
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("Failed to resolve RAV cache directory: {error}"))?;
        let canonical_cache_dir = std::fs::canonicalize(&cache_dir).map_err(|error| {
            format!(
                "Failed to resolve RAV cache directory {}: {error}",
                cache_dir.display()
            )
        })?;
        let canonical_html_path = std::fs::canonicalize(html_path).map_err(|error| {
            format!("Failed to resolve render surface HTML {html_path}: {error}")
        })?;

        if !canonical_html_path.starts_with(&canonical_cache_dir) {
            return Err("Render surface HTML must be inside the RAV app cache".to_string());
        }
        if canonical_html_path
            .extension()
            .and_then(|value| value.to_str())
            != Some("html")
        {
            return Err("Render surface cache file must have an .html extension".to_string());
        }

        return render_surface_file_url(&canonical_html_path, session_id);
    }

    let app_url = url.unwrap_or(RENDER_SURFACE_URL);
    if !is_safe_app_url(app_url) {
        return Err("Render surface url must be a relative app URL".to_string());
    }
    Ok(WebviewUrl::App(app_url.into()))
}

fn render_surface_file_url(
    html_path: &Path,
    session_id: Option<&str>,
) -> Result<WebviewUrl, String> {
    let mut file_url = Url::from_file_path(html_path).map_err(|_| {
        format!(
            "Failed to create render surface file URL for {}",
            html_path.display()
        )
    })?;
    append_render_surface_query(&mut file_url, session_id);
    Ok(WebviewUrl::External(file_url))
}

fn render_surface_protocol_url(session_id: Option<&str>) -> Result<WebviewUrl, String> {
    let mut url = Url::parse(&format!(
        "{RENDER_SURFACE_PROTOCOL}://localhost/{RENDER_SURFACE_FILE_NAME}"
    ))
    .map_err(|error| format!("Failed to create render surface protocol URL: {error}"))?;
    append_render_surface_query(&mut url, session_id);
    Ok(WebviewUrl::CustomProtocol(url))
}

fn append_render_surface_query(url: &mut Url, session_id: Option<&str>) {
    let mut query = url.query_pairs_mut();
    query.append_pair("renderSurface", "1");
    if let Some(session_id) = session_id.filter(|value| !value.trim().is_empty()) {
        query.append_pair("renderSession", session_id.trim());
    }
}

fn navigable_url(webview_url: &WebviewUrl) -> Option<Url> {
    match webview_url {
        WebviewUrl::External(url) | WebviewUrl::CustomProtocol(url) => Some(url.clone()),
        _ => None,
    }
}

fn is_safe_app_url(url: &str) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or_default();
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains("://")
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use super::{
        is_allowed_render_surface_event, is_safe_app_url, navigable_url,
        render_surface_protocol_url, RenderSurfaceBounds,
    };
    use tauri::{Position, Size};

    #[test]
    fn accepts_finite_positive_logical_bounds() {
        let bounds = RenderSurfaceBounds::new(10.5, -2.0, 1280.0, 720.0).expect("valid bounds");
        let rect = bounds.rect();

        assert_eq!(bounds.x, 10.5);
        assert_eq!(bounds.y, -2.0);
        assert_eq!(bounds.width, 1280.0);
        assert_eq!(bounds.height, 720.0);
        assert!(matches!(rect.position, Position::Logical(_)));
        assert!(matches!(rect.size, Size::Logical(_)));
    }

    #[test]
    fn rejects_non_finite_or_non_positive_bounds() {
        assert!(RenderSurfaceBounds::new(f64::NAN, 0.0, 1.0, 1.0).is_err());
        assert!(RenderSurfaceBounds::new(0.0, 0.0, 0.0, 1.0).is_err());
        assert!(RenderSurfaceBounds::new(0.0, 0.0, 1.0, -1.0).is_err());
        assert!(RenderSurfaceBounds::new(0.0, 0.0, f64::INFINITY, 1.0).is_err());
    }

    #[test]
    fn restricts_host_to_renderer_events() {
        assert!(is_allowed_render_surface_event("render-surface:load"));
        assert!(is_allowed_render_surface_event("render-surface:command"));
        assert!(!is_allowed_render_surface_event("render-surface:ready"));
        assert!(!is_allowed_render_surface_event("arbitrary-event"));
    }

    #[test]
    fn restricts_static_sources_to_relative_app_urls() {
        assert!(is_safe_app_url("render-surface.html"));
        assert!(is_safe_app_url("render-surface.html?renderSurface=1"));
        assert!(is_safe_app_url("assets/render-surface.html"));
        assert!(!is_safe_app_url("https://example.com/render.html"));
        assert!(!is_safe_app_url("/render-surface.html"));
        assert!(!is_safe_app_url("../render-surface.html"));
        assert!(!is_safe_app_url(""));
    }

    #[test]
    fn generated_surface_uses_local_protocol_and_session_query() {
        let url = render_surface_protocol_url(Some("session 12")).expect("protocol URL");
        let url = navigable_url(&url).expect("navigable URL");
        assert_eq!(url.scheme(), "rav-render");
        assert_eq!(url.host_str(), Some("localhost"));
        assert_eq!(url.path(), "/current-demo.html");
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "renderSurface")
                .unwrap()
                .1,
            "1"
        );
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "renderSession")
                .unwrap()
                .1,
            "session 12"
        );
    }
}
