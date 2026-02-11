// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::fs;
use tauri::{CustomMenuItem, Menu, MenuItem, Submenu};

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

#[cfg(debug_assertions)]
#[tauri::command]
fn open_devtools(window: tauri::Window) {
    // DevTools are only available in debug builds
    window.open_devtools();
}

#[cfg(not(debug_assertions))]
#[tauri::command]
fn open_devtools(_window: tauri::Window) {
    // In release builds, this is a no-op
    println!("DevTools are only available in debug builds");
}

#[tauri::command]
async fn make_demo_bundle(payload: DemoBundlePayload) -> Result<String, String> {
    let suggested = format!(
        "{}-demo.html",
        payload
            .file_name
            .replace(|c: char| !c.is_ascii_alphanumeric(), "-")
    );

    let save_path = tauri::api::dialog::blocking::FileDialogBuilder::new()
        .set_title("Save Rive Demo Viewer")
        .set_file_name(&suggested)
        .add_filter("HTML File", &["html"])
        .save_file();

    let path = match save_path {
        Some(path) => path,
        None => return Err("Save canceled".into()),
    };

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
    let escaped_config = config_json
        .replace('\\', "\\\\")
        .replace('\'', "\\'");
    let escaped_runtime = payload.runtime_script.replace("</script", "<\\/script");
    let canvas_color = payload
        .canvas_color
        .as_deref()
        .unwrap_or("#0d1117");
    let runtime_display = if payload.runtime_name == "canvas" {
        "Canvas"
    } else {
        "WebGL"
    };
    let runtime_version = payload
        .runtime_version
        .as_deref()
        .unwrap_or("unknown");
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

fn build_menu(about_item: &CustomMenuItem) -> Menu {
    let app_menu = Submenu::new(
        "Rive Animation Viewer",
        Menu::new()
            .add_item(about_item.clone())
            .add_native_item(MenuItem::Separator)
            .add_native_item(MenuItem::Services)
            .add_native_item(MenuItem::Separator)
            .add_native_item(MenuItem::Hide)
            .add_native_item(MenuItem::HideOthers)
            .add_native_item(MenuItem::ShowAll)
            .add_native_item(MenuItem::Separator)
            .add_native_item(MenuItem::Quit),
    );

    let edit_menu = Submenu::new(
        "Edit",
        Menu::new()
            .add_native_item(MenuItem::Undo)
            .add_native_item(MenuItem::Redo)
            .add_native_item(MenuItem::Separator)
            .add_native_item(MenuItem::Cut)
            .add_native_item(MenuItem::Copy)
            .add_native_item(MenuItem::Paste)
            .add_native_item(MenuItem::SelectAll),
    );

    let view_menu = Submenu::new(
        "View",
        Menu::new().add_native_item(MenuItem::EnterFullScreen),
    );

    let window_menu = Submenu::new(
        "Window",
        Menu::new()
            .add_native_item(MenuItem::Minimize)
            .add_native_item(MenuItem::Zoom)
            .add_native_item(MenuItem::Separator)
            .add_native_item(MenuItem::CloseWindow),
    );

    Menu::new()
        .add_submenu(app_menu)
        .add_submenu(edit_menu)
        .add_submenu(view_menu)
        .add_submenu(window_menu)
}

fn main() {
    let about_item = CustomMenuItem::new("about_ivg", "About Rive Animation Viewer");

    tauri::Builder::default()
        .menu(build_menu(&about_item))
        .on_menu_event(move |event| {
            if event.menu_item_id() == "about_ivg" {
                let message = format!(
          "Rive Animation Viewer v{}\n© 2025 IVG Design · MIT License\nRive runtime © Rive",
          env!("CARGO_PKG_VERSION")
        );
                tauri::api::dialog::message(
                    Some(event.window()),
                    "About Rive Animation Viewer",
                    message,
                );
            }
        })
        .invoke_handler(tauri::generate_handler![make_demo_bundle, open_devtools])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
