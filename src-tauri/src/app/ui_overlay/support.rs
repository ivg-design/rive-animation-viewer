#[cfg(target_os = "linux")]
use tauri::Manager;
use tauri::{AppHandle, Webview};

#[cfg(target_os = "macos")]
use objc2_app_kit::NSView;

pub(super) const UI_OVERLAY_CORNER_RADIUS: f64 = 8.0;

#[cfg(target_os = "linux")]
const MAIN_WINDOW_LABEL: &str = "main";

pub(super) fn is_ui_overlay_supported(app: AppHandle) -> bool {
    #[cfg(target_os = "linux")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        let Some(window) = app.get_window(MAIN_WINDOW_LABEL) else {
            return false;
        };
        let Ok(handle) = window.window_handle() else {
            return false;
        };
        matches!(handle.as_raw(), RawWindowHandle::Xlib(_))
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let _ = app;
        true
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
pub(super) fn apply_native_corner_clip(webview: &Webview) -> Result<(), String> {
    webview
        .with_webview(|platform| unsafe {
            let view: &NSView = &*platform.inner().cast();
            view.setWantsLayer(true);
            if let Some(layer) = view.layer() {
                layer.setCornerRadius(UI_OVERLAY_CORNER_RADIUS);
                layer.setMasksToBounds(true);
            }
        })
        .map_err(|error| format!("failed to round native UI overlay: {error}"))
}

#[cfg(not(target_os = "macos"))]
pub(super) fn apply_native_corner_clip(_webview: &Webview) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::UI_OVERLAY_CORNER_RADIUS;

    #[test]
    fn native_corner_radius_matches_the_overlay_css_contract() {
        assert_eq!(UI_OVERLAY_CORNER_RADIUS, 8.0);
    }
}
