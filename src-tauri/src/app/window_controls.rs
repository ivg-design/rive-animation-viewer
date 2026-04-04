use std::process::Command;

use rfd::FileDialog;
use tauri::WebviewWindow;

use crate::app::state::WindowCursorPosition;

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSWindow, NSWindowButton, NSWindowTitleVisibility};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

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
pub fn window_chrome_is_maximized(window: WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn window_chrome_toggle_maximize(window: WebviewWindow) -> Result<bool, String> {
    let should_maximize = !window.is_maximized().map_err(|error| error.to_string())?;
    if should_maximize {
        window.maximize().map_err(|error| error.to_string())?;
    } else {
        window.unmaximize().map_err(|error| error.to_string())?;
    }
    Ok(should_maximize)
}

#[tauri::command]
pub fn window_chrome_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn window_chrome_close(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn window_chrome_start_dragging(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
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

#[cfg(target_os = "macos")]
pub fn configure_native_window_chrome(window: &WebviewWindow) -> Result<(), String> {
    let raw_window = window.ns_window().map_err(|error| error.to_string())? as usize;
    window
        .run_on_main_thread(move || unsafe {
            if raw_window == 0 {
                return;
            }

            let ns_window = &*(raw_window as *mut NSWindow);
            ns_window.setTitlebarAppearsTransparent(true);
            ns_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
            ns_window.setHasShadow(true);
            ns_window.setOpaque(false);
            ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
            ns_window.setMovableByWindowBackground(false);

            if let Some(content_view) = ns_window.contentView() {
                content_view.setWantsLayer(true);
            }

            for button in [
                NSWindowButton::CloseButton,
                NSWindowButton::MiniaturizeButton,
                NSWindowButton::ZoomButton,
            ] {
                if let Some(native_button) = ns_window.standardWindowButton(button) {
                    native_button.setHidden(true);
                    native_button.setAlphaValue(0.0);
                    if let Some(parent_view) = native_button.superview() {
                        parent_view.setHidden(true);
                        parent_view.setAlphaValue(0.0);
                    }
                }
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn configure_native_window_chrome(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}
