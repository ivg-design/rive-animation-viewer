use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use crate::app::demo_bundle::write_demo_html_atomically;
use crate::app::state::DemoBundlePayload;

const ISOLATED_PLAYBACK_DIRECTORY: &str = "isolated-playback";
const ISOLATED_PLAYBACK_FILE_NAME: &str = "current-demo.html";
static ISOLATED_PLAYBACK_WINDOW_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// Opens the same self-contained demo produced by the standalone exporter in a
/// separate, ordinary Tauri webview. This is intentionally an A/B diagnostic
/// surface, not a second playback webview inside the main RAV window.
#[tauri::command]
pub async fn open_isolated_playback(
    app: AppHandle,
    payload: DemoBundlePayload,
) -> Result<IsolatedPlaybackResult, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to resolve RAV cache directory: {error}"))?;
    let html_path = write_isolated_playback_html(&cache_dir, &payload)?;
    let url = Url::from_file_path(&html_path).map_err(|_| {
        format!(
            "Failed to create a file URL for isolated playback: {}",
            html_path.display()
        )
    })?;
    let sequence = ISOLATED_PLAYBACK_WINDOW_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let window_label = format!("isolated-playback-{sequence}");
    let title = format!("Isolated Playback — {}", payload.file_name);

    WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::External(url))
        .title(title)
        .inner_size(1280.0, 900.0)
        .min_inner_size(640.0, 480.0)
        .resizable(true)
        .decorations(true)
        .build()
        .map_err(|error| format!("Failed to open isolated playback window: {error}"))?;

    Ok(IsolatedPlaybackResult {
        html_path: html_path.to_string_lossy().to_string(),
        window_label,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IsolatedPlaybackResult {
    pub html_path: String,
    pub window_label: String,
}

pub fn isolated_playback_html_path(cache_dir: &Path) -> PathBuf {
    cache_dir
        .join(ISOLATED_PLAYBACK_DIRECTORY)
        .join(ISOLATED_PLAYBACK_FILE_NAME)
}

fn write_isolated_playback_html(
    cache_dir: &Path,
    payload: &DemoBundlePayload,
) -> Result<PathBuf, String> {
    let html_path = isolated_playback_html_path(cache_dir);
    write_demo_html_atomically(payload, &html_path)
}

#[cfg(test)]
mod tests {
    use super::{isolated_playback_html_path, write_isolated_playback_html};
    use crate::app::state::DemoBundlePayload;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_payload() -> DemoBundlePayload {
        DemoBundlePayload {
            animation_base64: "AQID".into(),
            animations: vec![],
            artboard_name: Some("Main".into()),
            autoplay: true,
            canvas_color: Some("#0d1117".into()),
            canvas_sizing: None,
            canvas_transparent: false,
            control_selection_keys: None,
            inspection_metadata: None,
            control_snapshot: None,
            default_instantiation_package_source: "cdn".into(),
            editor_code: String::new(),
            file_name: "demo.riv".into(),
            instantiation_code: String::new(),
            instantiation_snippets: None,
            instantiation_source_mode: "internal".into(),
            layout_alignment: "center".into(),
            layout_fit: "contain".into(),
            layout_state: None,
            runtime_name: "webgl2".into(),
            runtime_script: "console.log('runtime');".into(),
            runtime_version: Some("2.39.2".into()),
            state_machines: vec!["Main".into()],
            view_model_instance_name: None,
            vm_hierarchy: None,
        }
    }

    #[test]
    fn writes_isolated_playback_to_the_app_owned_cache_location() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let cache_dir = std::env::temp_dir().join(format!("rav-isolated-playback-{suffix}"));
        let expected_path = isolated_playback_html_path(&cache_dir);

        let written_path = write_isolated_playback_html(&cache_dir, &test_payload())
            .expect("isolated playback html");

        assert_eq!(written_path, expected_path);
        let html = std::fs::read_to_string(&written_path).expect("written html");
        assert!(html.contains("Rive Demo"));
        assert!(html.contains("console.log('runtime');"));

        std::fs::remove_dir_all(cache_dir).expect("cleanup test cache directory");
    }
}
