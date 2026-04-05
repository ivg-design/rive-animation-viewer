use std::process::Command;

use rfd::FileDialog;
use tauri::WebviewWindow;

use crate::app::state::WindowCursorPosition;

#[cfg(target_os = "windows")]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute,
    DWMWA_WINDOW_CORNER_PREFERENCE,
    DWMWCP_ROUND,
    DWM_WINDOW_CORNER_PREFERENCE,
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(debug_assertions)]
#[tauri::command]
pub fn open_devtools(window: WebviewWindow) {
    window.open_devtools();
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub fn open_devtools(_window: WebviewWindow) {
    println!("DevTools are only available in debug builds");
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Only http(s) URLs are supported".into());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(trimmed);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", trimmed]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(trimmed);
        cmd
    };

    command
        .status()
        .map_err(|error| error.to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(format!("Failed to open {trimmed}"))
            }
        })
}

#[tauri::command]
pub fn set_window_transparency_mode(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    let color = if enabled {
        tauri::window::Color(0, 0, 0, 0)
    } else {
        tauri::window::Color(10, 10, 10, 255)
    };
    window
        .set_background_color(Some(color))
        .map_err(|error| error.to_string())?;

    #[cfg(desktop)]
    {
        if let Err(error) = window.set_shadow(!enabled) {
            eprintln!("failed to set window shadow: {error}");
        }
    }

    Ok(())
}

#[tauri::command]
pub fn set_window_click_through(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_window_click_through_mode(
    window: WebviewWindow,
    enabled: bool,
) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|error| error.to_string())?;
    if !enabled {
        let _ = window.set_ignore_cursor_events(false);
    }
    Ok(())
}

#[tauri::command]
pub fn get_window_cursor_position(window: WebviewWindow) -> Option<WindowCursorPosition> {
    window
        .cursor_position()
        .ok()
        .map(|position| WindowCursorPosition {
            x: position.x,
            y: position.y,
        })
}

#[tauri::command]
pub fn pick_riv_file() -> Option<String> {
    FileDialog::new()
        .add_filter("Rive Animation", &["riv"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
pub fn apply_windows_corner_preference(window: &WebviewWindow) -> Result<(), String> {
    let window_handle = window.window_handle().map_err(|error| error.to_string())?;
    let hwnd = match window_handle.as_raw() {
        RawWindowHandle::Win32(handle) => handle.hwnd.get() as HWND,
        _ => return Err("Expected a Win32 window handle".into()),
    };

    let preference: DWM_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND;
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const _ as *const _,
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        )
    };

    if result == 0 {
        Ok(())
    } else {
        Err(format!("DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE) failed: 0x{result:08x}"))
    }
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub fn apply_windows_corner_preference(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}
