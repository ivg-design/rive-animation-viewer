use tauri::AppHandle;
#[cfg(target_os = "linux")]
use tauri::Manager;

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
