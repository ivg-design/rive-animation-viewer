use std::process::Command;

use rfd::{AsyncFileDialog, FileHandle};
use serde::Serialize;
use tauri::{State, WebviewWindow, Window};

use super::image_validation::validate_picked_image_dimensions;
use crate::app::state::NativeDialogState;

#[cfg(target_os = "windows")]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    DWM_WINDOW_CORNER_PREFERENCE,
};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowButton};

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
pub async fn pick_riv_file(
    window: Window,
    state: State<'_, NativeDialogState>,
) -> Result<Option<String>, String> {
    let _lease = state.try_acquire()?;
    Ok(AsyncFileDialog::new()
        .add_filter("Rive Animation", &["riv"])
        .set_parent(&window)
        .pick_file()
        .await
        .map(|handle| handle.path().to_string_lossy().to_string()))
}

/// A user-selected image deliberately contains no filesystem path. The caller
/// only needs the display name and decoded bytes to update a Rive image input.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PickedImageFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

fn image_file_dialog() -> AsyncFileDialog {
    AsyncFileDialog::new().add_filter(
        "Image files",
        &[
            "png", "jpg", "jpeg", "webp", "avif", "gif", "bmp", "ico", "tif", "tiff",
        ],
    )
}

/// Upper bound for a native image substitution before its bytes are loaded.
// Keep native selection aligned with the authoritative replay journal's
// per-image limit. An accepted substitution must survive surface recreation.
const MAX_PICKED_IMAGE_BYTES: u64 = 16 * 1024 * 1024;

async fn picked_image_from_path(path: std::path::PathBuf) -> Result<PickedImageFile, String> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    if name.is_empty() {
        return Err("The selected image has no usable file name.".to_string());
    }
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|error| format!("Unable to inspect selected image {name}: {error}"))?;
    if metadata.len() > MAX_PICKED_IMAGE_BYTES {
        return Err(format!(
            "Selected image {name} is too large; the maximum supported size is 16 MiB."
        ));
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| format!("Unable to read selected image {name}: {error}"))?;
    validate_picked_image_dimensions(&bytes)
        .map_err(|error| format!("Unable to use selected image {name}: {error}"))?;
    Ok(PickedImageFile { name, bytes })
}

async fn picked_image_from_handle(handle: FileHandle) -> Result<PickedImageFile, String> {
    picked_image_from_path(handle.path().to_path_buf()).await
}

/// Opens a native image dialog for a ViewModel image substitution.
///
/// `None` represents user cancellation. No source path is returned or retained,
/// which keeps file-system metadata out of the UI, telemetry, and child bridge.
#[tauri::command]
pub async fn pick_image_file(
    window: Window,
    state: State<'_, NativeDialogState>,
) -> Result<Option<PickedImageFile>, String> {
    let _lease = state.try_acquire()?;
    let picked = image_file_dialog().set_parent(&window).pick_file().await;
    match picked {
        Some(handle) => picked_image_from_handle(handle).await.map(Some),
        None => Ok(None),
    }
}

#[cfg(target_os = "macos")]
pub fn hide_macos_traffic_lights(window: &WebviewWindow) -> Result<(), String> {
    window
        .with_webview(|webview| unsafe {
            let native_window: &NSWindow = &*webview.ns_window().cast();
            for button_kind in [
                NSWindowButton::CloseButton,
                NSWindowButton::MiniaturizeButton,
                NSWindowButton::ZoomButton,
            ] {
                if let Some(button) = native_window.standardWindowButton(button_kind) {
                    button.setHidden(true);
                }
            }
        })
        .map_err(|error| format!("failed to access native macOS window: {error}"))
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn hide_macos_traffic_lights(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
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
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &preference as *const _ as *const _,
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        )
    };

    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE) failed: 0x{result:08x}"
        ))
    }
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub fn apply_windows_corner_preference(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{picked_image_from_path, MAX_PICKED_IMAGE_BYTES};
    use crate::app::state::NativeDialogState;

    #[tokio::test]
    async fn picked_image_exposes_name_and_bytes_but_not_a_path() {
        let directory =
            std::env::temp_dir().join(format!("rav-picked-image-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).expect("create temporary directory");
        let image_path = directory.join("fixture.png");
        let bytes = [
            0x89_u8, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R',
            0, 0, 0, 1, 0, 0, 0, 1,
        ];
        std::fs::write(&image_path, bytes).expect("write fixture");

        let picked = picked_image_from_path(image_path)
            .await
            .expect("read fixture");
        assert_eq!(picked.name, "fixture.png");
        assert_eq!(picked.bytes, bytes);

        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn picked_image_rejects_dimension_bombs_without_changing_the_previous_control() {
        let directory = std::env::temp_dir().join(format!(
            "rav-picked-image-dimension-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).expect("create temporary directory");
        let image_path = directory.join("dimension-bomb.png");
        let bytes = [
            0x89_u8, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R',
            0, 0, 0x40, 1, 0, 0, 0, 1,
        ];
        std::fs::write(&image_path, bytes).expect("write fixture");

        let error = picked_image_from_path(image_path)
            .await
            .expect_err("oversized dimensions should be rejected");
        assert_eq!(
            error,
            "Unable to use selected image dimension-bomb.png: The PNG image dimensions 16385×1 exceed the safe substitution limit."
        );

        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn picked_image_rejects_oversized_jpeg_dimensions_before_runtime_decode() {
        let directory = std::env::temp_dir().join(format!(
            "rav-picked-jpeg-dimension-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).expect("create temporary directory");
        let image_path = directory.join("dimension-bomb.jpg");
        let bytes = [
            0xff_u8, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0xe3, 0xa6, 0x5f, 0xf6, 0x01, 0x01, 0x11,
            0x00,
        ];
        std::fs::write(&image_path, bytes).expect("write fixture");

        let error = picked_image_from_path(image_path)
            .await
            .expect_err("oversized JPEG dimensions should be rejected");
        assert_eq!(
            error,
            "Unable to use selected image dimension-bomb.jpg: The JPEG image dimensions 24566×58278 exceed the safe substitution limit."
        );

        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn picked_image_rejects_files_over_the_size_limit_before_reading() {
        let directory =
            std::env::temp_dir().join(format!("rav-picked-image-size-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).expect("create temporary directory");
        let image_path = directory.join("oversized.webp");
        let file = std::fs::File::create(&image_path).expect("create sparse fixture");
        file.set_len(MAX_PICKED_IMAGE_BYTES + 1)
            .expect("size sparse fixture");

        let error = picked_image_from_path(image_path)
            .await
            .expect_err("oversized image should be rejected");
        assert_eq!(
            error,
            "Selected image oversized.webp is too large; the maximum supported size is 16 MiB."
        );

        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn image_picker_state_rejects_concurrent_leases_and_recovers_after_drop() {
        let state = NativeDialogState::default();
        let lease = state.try_acquire().expect("acquire first picker lease");
        assert_eq!(
            state.try_acquire().err().as_deref(),
            Some("A native file dialog is already open.")
        );
        drop(lease);
        assert!(state.try_acquire().is_ok());
    }
}
