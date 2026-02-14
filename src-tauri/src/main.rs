// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use std::collections::VecDeque;
use std::fs;
use std::sync::Mutex;
use tauri::menu::Menu;
use tauri::{Emitter, Manager};

#[derive(Deserialize)]
struct DemoBundlePayload {
    file_name: String,
    animation_base64: String,
    runtime_name: String,
    runtime_version: Option<String>,
    runtime_script: String,
    autoplay: bool,
    layout_fit: String,
    state_machines: Vec<String>,
    artboard_name: Option<String>,
    canvas_color: Option<String>,
    #[serde(default)]
    canvas_transparent: bool,
    layout_state: Option<String>,
    vm_hierarchy: Option<String>,
}

// State: queue of file paths passed via Open With / double click.
struct OpenedFiles(Mutex<VecDeque<String>>);

#[cfg(debug_assertions)]
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

#[cfg(not(debug_assertions))]
#[tauri::command]
fn open_devtools(_window: tauri::WebviewWindow) {
    println!("DevTools are only available in debug builds");
}

#[tauri::command]
fn get_opened_file(state: tauri::State<'_, OpenedFiles>) -> Option<String> {
    state.0.lock().ok().and_then(|mut guard| guard.pop_front())
}

#[tauri::command]
fn read_riv_file(path: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("File path is empty".into());
    }
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    Ok(STANDARD.encode(&bytes))
}

#[tauri::command]
fn set_window_transparency_mode(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    let color = if enabled {
        tauri::window::Color(0, 0, 0, 0)
    } else {
        tauri::window::Color(10, 10, 10, 255)
    };
    window
        .set_background_color(Some(color))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_window_click_through(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn make_demo_bundle(payload: DemoBundlePayload) -> Result<String, String> {
    let suggested = format!(
        "{}-demo.html",
        payload
            .file_name
            .replace(|c: char| !c.is_ascii_alphanumeric(), "-")
    );

    let save_path = rfd::FileDialog::new()
        .set_title("Save Rive Demo Viewer")
        .set_file_name(&suggested)
        .add_filter("HTML File", &["html"])
        .save_file();

    let path = save_path.ok_or_else(|| "Save canceled".to_string())?;

    let html = build_demo_html(&payload).map_err(|error| error.to_string())?;
    fs::write(&path, html).map_err(|error| error.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

fn build_demo_html(payload: &DemoBundlePayload) -> Result<String, serde_json::Error> {
    use serde_json::json;

    let layout_state = payload
        .layout_state
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .unwrap_or_else(|| json!({}));

    let config = json!({
      "runtimeName": payload.runtime_name,
      "runtimeVersion": payload.runtime_version,
      "animationBase64": payload.animation_base64,
      "autoplay": payload.autoplay,
      "layoutFit": payload.layout_fit,
      "stateMachines": payload.state_machines,
      "artboardName": payload.artboard_name,
      "canvasColor": payload
        .canvas_color
        .clone()
        .unwrap_or_else(|| "#0d1117".into()),
      "canvasTransparent": payload.canvas_transparent,
      "layoutState": layout_state
    });
    let config_json = serde_json::to_string(&config)?;
    let escaped_config = config_json.replace('\\', "\\\\").replace('\'', "\\'");
    let escaped_runtime = payload.runtime_script.replace("</script", "<\\/script");
    let canvas_color = payload.canvas_color.as_deref().unwrap_or("#0d1117");
    let runtime_display = if payload.runtime_name == "canvas" {
        "Canvas"
    } else {
        "WebGL"
    };
    let runtime_version = payload.runtime_version.as_deref().unwrap_or("unknown");
    let app_icon_data_url = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(include_bytes!("../icons/128x128.png"))
    );
    let vm_hierarchy_json = payload
        .vm_hierarchy
        .as_deref()
        .unwrap_or("null")
        .replace('\\', "\\\\")
        .replace('\'', "\\'");
    let title = format!("{} – Rive Demo", payload.file_name);

    let template = include_str!("demo-template.html");

    let html = template
        .replace("__TITLE__", &title)
        .replace("__CANVAS_COLOR__", canvas_color)
        .replace("__CONFIG_JSON__", &escaped_config)
        .replace("__RUNTIME_SCRIPT__", &escaped_runtime)
        .replace("__VM_HIERARCHY_JSON__", &vm_hierarchy_json)
        .replace("__FILE_NAME__", &payload.file_name)
        .replace("__RUNTIME_DISPLAY__", runtime_display)
        .replace("__APP_ICON_DATA_URL__", &app_icon_data_url)
        .replace("__RUNTIME_VERSION__", runtime_version);

    Ok(html)
}

fn looks_like_riv_file(value: &str) -> bool {
    value.trim().to_ascii_lowercase().ends_with(".riv")
}

fn extract_opened_riv_file_args_from_iter<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .filter_map(|arg| {
            let trimmed = arg.as_ref().trim_matches('"').trim().to_string();
            if trimmed.is_empty() || trimmed.starts_with('-') {
                return None;
            }

            let lower = trimmed.to_ascii_lowercase();
            if looks_like_riv_file(&trimmed) || (lower.starts_with("file://") && lower.contains(".riv")) {
                Some(trimmed)
            } else {
                None
            }
        })
        .collect()
}

fn extract_opened_riv_file_args() -> Vec<String> {
    extract_opened_riv_file_args_from_iter(std::env::args().skip(1))
}

fn try_emit_open_file(app: &tauri::AppHandle, path: String) {
    let _ = app.emit("open-file", path);
}

fn queue_pending_opened_file(app: &tauri::AppHandle, path: &str) {
    if let Some(state) = app.try_state::<OpenedFiles>() {
        if let Ok(mut guard) = state.0.lock() {
            if !guard.iter().any(|entry| entry == path) {
                guard.push_back(path.to_string());
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    let opened_files = extract_opened_riv_file_args();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for path in extract_opened_riv_file_args_from_iter(argv.iter().skip(1).map(String::as_str)) {
                queue_pending_opened_file(app, &path);
                try_emit_open_file(app, path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(OpenedFiles(Mutex::new(VecDeque::from(opened_files))))
        .setup(|app| {
            #[cfg(desktop)]
            {
                let menu = Menu::default(app.handle())?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            make_demo_bundle,
            open_devtools,
            get_opened_file,
            read_riv_file,
            set_window_transparency_mode,
            set_window_click_through
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                let opened_files: Vec<String> = urls
                    .into_iter()
                    .filter_map(|url| {
                        if let Ok(path) = url.to_file_path() {
                            let value = path.to_string_lossy().to_string();
                            if looks_like_riv_file(&value) {
                                return Some(value);
                            }
                            return None;
                        }

                        let value = url.to_string();
                        if looks_like_riv_file(&value) {
                            return Some(value);
                        }
                        None
                    })
                    .collect();

                for path in opened_files {
                    // Persist for frontend startup handoff in case event listener
                    // isn't registered yet when the app is cold-launched.
                    queue_pending_opened_file(app, &path);
                    // Forward to frontend when app is already running.
                    try_emit_open_file(app, path);
                }
            }
        });
}
