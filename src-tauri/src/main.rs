// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;

use std::collections::VecDeque;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItemBuilder, HELP_SUBMENU_ID};
#[cfg(target_os = "macos")]
use tauri::menu::{PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{Emitter, Manager};

use crate::app::constants::{ABOUT_MENU_ID, DEFAULT_MCP_PORT, ONLINE_DOCS_MENU_ID, RAV_DOCS_URL};
use crate::app::mcp::bridge::{initialize_mcp_bridge, kill_spawned_mcp_bridge};
use crate::app::state::{McpBridgeManager, OpenedFiles, PendingAppUpdate};
use crate::app::support::{
    extract_opened_riv_file_args,
    extract_opened_riv_file_args_from_iter,
    looks_like_riv_file,
    queue_pending_opened_file,
    try_emit_open_file,
};
use crate::app::window_controls::{configure_native_window_chrome, open_external_url};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    let opened_files = extract_opened_riv_file_args();

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for path in
                extract_opened_riv_file_args_from_iter(argv.iter().skip(1).map(String::as_str))
            {
                queue_pending_opened_file(app, &path);
                try_emit_open_file(app, path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_menu_event(|app, event| match event.id().as_ref() {
            ONLINE_DOCS_MENU_ID => {
                let _ = open_external_url(RAV_DOCS_URL.to_string());
            }
            ABOUT_MENU_ID => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("show-about", ());
                }
                let _ = app.emit("show-about", ());
            }
            _ => {}
        })
        .manage(OpenedFiles(Mutex::new(VecDeque::from(opened_files))))
        .manage(McpBridgeManager::new(DEFAULT_MCP_PORT))
        .manage(PendingAppUpdate::default())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let menu = build_desktop_menu(app.handle())?;
                app.set_menu(menu)?;
            }

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    let _ = window.set_decorations(false);
                    let _ = window.set_background_color(Some(tauri::window::Color(10, 10, 10, 255)));
                    let _ = window.set_theme(Some(tauri::Theme::Dark));
                }

                #[cfg(target_os = "macos")]
                {
                    let _ = window.set_decorations(true);
                    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
                }

                let _ = configure_native_window_chrome(&window);
            }

            let bridge_manager = app.state::<McpBridgeManager>();
            if let Err(error) = initialize_mcp_bridge(app.handle(), &bridge_manager) {
                eprintln!("[rav-app] failed to start MCP bridge: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app::demo_bundle::make_demo_bundle,
            app::demo_bundle::make_demo_bundle_to_path,
            app::mcp::bridge::get_mcp_server_path,
            app::mcp::bridge::get_mcp_port,
            app::mcp::bridge::set_mcp_port,
            app::mcp::bridge::stop_mcp_bridge,
            app::mcp::commands::get_mcp_setup_status,
            app::mcp::commands::install_mcp_client,
            app::mcp::commands::remove_mcp_client,
            app::node_runtime::detect_node_runtime,
            app::updater::check_for_app_update,
            app::updater::install_app_update,
            app::updater::relaunch_app,
            app::window_controls::open_devtools,
            app::window_controls::open_external_url,
            app::window_controls::set_window_transparency_mode,
            app::window_controls::set_window_click_through,
            app::window_controls::set_window_click_through_mode,
            app::window_controls::get_window_cursor_position,
            app::window_controls::pick_riv_file,
            app::window_controls::window_chrome_is_maximized,
            app::window_controls::window_chrome_toggle_maximize,
            app::window_controls::window_chrome_minimize,
            app::window_controls::window_chrome_close,
            app::window_controls::window_chrome_start_dragging,
            get_opened_file,
            read_riv_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(manager) = app.try_state::<McpBridgeManager>() {
                    kill_spawned_mcp_bridge(app, &manager);
                }
            }

            if let tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }),
                ..
            } = &event
            {
                for path in paths {
                    let value = path.to_string_lossy().to_string();
                    if !looks_like_riv_file(&value) {
                        continue;
                    }
                    queue_pending_opened_file(app, &value);
                    try_emit_open_file(app, value);
                }
            }

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
                    queue_pending_opened_file(app, &path);
                    try_emit_open_file(app, path);
                }
            }
        });
}

#[cfg(desktop)]
fn build_desktop_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    #[cfg(target_os = "macos")]
    {
        let pkg_info = app.package_info();
        let about_item = MenuItemBuilder::with_id(ABOUT_MENU_ID, "About Rive Animation Viewer")
            .build(app)?;
        let docs_item = MenuItemBuilder::with_id(ONLINE_DOCS_MENU_ID, "RAV Documentation")
            .build(app)?;

        let app_menu = Submenu::with_items(
            app,
            pkg_info.name.clone(),
            true,
            &[
                &about_item,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;

        let file_menu = Submenu::with_items(
            app,
            "File",
            true,
            &[&PredefinedMenuItem::close_window(app, None)?],
        )?;

        let edit_menu = Submenu::with_items(
            app,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ],
        )?;

        let view_menu = Submenu::with_items(
            app,
            "View",
            true,
            &[&PredefinedMenuItem::fullscreen(app, None)?],
        )?;

        let window_menu = Submenu::with_id_and_items(
            app,
            WINDOW_SUBMENU_ID,
            "Window",
            true,
            &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::maximize(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, None)?,
            ],
        )?;

        let help_menu = Submenu::with_id_and_items(
            app,
            HELP_SUBMENU_ID,
            "Help",
            true,
            &[&docs_item],
        )?;

        return Menu::with_items(
            app,
            &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &view_menu,
                &window_menu,
                &help_menu,
            ],
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        let menu = Menu::default(app)?;
        let docs_item = MenuItemBuilder::with_id(ONLINE_DOCS_MENU_ID, "RAV Documentation")
            .build(app)?;
        if let Some(tauri::menu::MenuItemKind::Submenu(help_menu)) = menu.get(HELP_SUBMENU_ID) {
            help_menu.append(&docs_item)?;
        }
        Ok(menu)
    }
}

#[tauri::command]
fn get_opened_file(state: tauri::State<'_, OpenedFiles>) -> Option<String> {
    state.0.lock().ok().and_then(|mut guard| guard.pop_front())
}

#[tauri::command]
fn read_riv_file(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::fs;

    if path.trim().is_empty() {
        return Err("File path is empty".into());
    }
    let bytes = fs::read(&path).map_err(|error| format!("Failed to read {}: {}", path, error))?;
    Ok(STANDARD.encode(&bytes))
}
