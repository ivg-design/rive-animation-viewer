use std::process::Command;

use tauri::WebviewWindow;

use crate::app::state::WindowCursorPosition;

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
