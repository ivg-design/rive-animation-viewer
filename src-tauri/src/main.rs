// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
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
    vm_hierarchy: Option<String>,
}

// State: holds a file path passed via Open With / double click for first-load handoff.
struct OpenedFile(Mutex<Option<String>>);

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
fn get_opened_file(state: tauri::State<'_, OpenedFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut guard| guard.take())
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
        .unwrap_or_else(|| "#0d1117".into())
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
        .replace("__RUNTIME_VERSION__", runtime_version);

    Ok(html)
}

fn looks_like_riv_file(value: &str) -> bool {
    value.trim().to_ascii_lowercase().ends_with(".riv")
}

fn extract_opened_riv_file_arg() -> Option<String> {
    std::env::args().skip(1).find_map(|arg| {
        let trimmed = arg.trim_matches('"').trim().to_string();
        if trimmed.is_empty() || trimmed.starts_with('-') {
            return None;
        }
        if looks_like_riv_file(&trimmed)
            || (trimmed.to_ascii_lowercase().starts_with("file://")
                && trimmed.to_ascii_lowercase().contains(".riv"))
        {
            return Some(trimmed);
        }
        None
    })
}

fn try_emit_open_file(app: &tauri::AppHandle, path: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("open-file", path);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    let opened_file = extract_opened_riv_file_arg();

    tauri::Builder::default()
        .manage(OpenedFile(Mutex::new(opened_file)))
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
            read_riv_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                let maybe_file = urls.into_iter().find_map(|url| {
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
                });

                if let Some(path) = maybe_file {
                    // Forward to frontend when app is already running.
                    try_emit_open_file(app, path);
                }
            }
        });
}
