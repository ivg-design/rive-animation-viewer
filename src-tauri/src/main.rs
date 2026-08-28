// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;

use std::collections::VecDeque;
use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::app::constants::{
    is_official_app_identifier, ABOUT_MENU_ID, DEFAULT_MCP_PORT, ISOLATED_DEV_MCP_PORT,
    ONLINE_DOCS_MENU_ID, RAV_DOCS_URL,
};
use crate::app::install_counter::InstallCounterManager;
use crate::app::mcp::bridge::{
    initialize_mcp_bridge, kill_spawned_mcp_bridge, refresh_mcp_client_launcher_if_present,
};
use crate::app::operational_trace::{file_basename, record, OperationalTrace};
use crate::app::render_surface::RenderSurfaceManager;
use crate::app::state::{McpBridgeManager, NativeDialogState, OpenedFiles, PendingAppUpdate};
use crate::app::support::{
    extract_opened_riv_file_args, extract_opened_riv_file_args_from_iter, looks_like_riv_file,
    queue_pending_opened_file, try_emit_open_file,
};
use crate::app::ui_overlay::UiOverlayManager;
#[cfg(target_os = "windows")]
use crate::app::window::controls::apply_windows_corner_preference;
#[cfg(target_os = "macos")]
use crate::app::window::controls::hide_macos_traffic_lights;
use crate::app::window::controls::open_external_url;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    let opened_files = extract_opened_riv_file_args();
    let updater_acceptance = app::updater::UpdaterAcceptance::from_process_env()
        .unwrap_or_else(|error| panic!("invalid updater acceptance configuration: {error}"));
    let telemetry_acceptance =
        app::install_counter::telemetry_acceptance::TelemetryAcceptanceDriver::from_process_env()
            .unwrap_or_else(|error| panic!("invalid telemetry acceptance configuration: {error}"));

    tauri::Builder::default()
        .register_uri_scheme_protocol(
            app::render_surface::RENDER_SURFACE_PROTOCOL,
            app::render_surface::serve_render_surface_protocol,
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let opened_files =
                extract_opened_riv_file_args_from_iter(argv.iter().skip(1).map(String::as_str));
            for path in opened_files {
                record(
                    app,
                    "opened_file.ingress_single_instance",
                    serde_json::json!({ "fileName": file_basename(&path) }),
                );
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
            }
            _ => {}
        })
        .manage(OpenedFiles(Mutex::new(VecDeque::from(opened_files.clone()))))
        .manage(OperationalTrace::default())
        .manage(InstallCounterManager::default())
        .manage(McpBridgeManager::new(DEFAULT_MCP_PORT))
        .manage(PendingAppUpdate::default())
        .manage(NativeDialogState::default())
        .manage(RenderSurfaceManager::default())
        .manage(UiOverlayManager::default())
        .manage(updater_acceptance)
        .manage(telemetry_acceptance)
        .setup(move |app| {
            let operational_trace = app.state::<OperationalTrace>();
            app::operational_trace::initialize(app.handle(), &operational_trace);
            record(
                app.handle(),
                "setup.begin",
                serde_json::json!({
                    "initialOpenedFiles": opened_files.iter().map(|path| file_basename(path)).collect::<Vec<_>>(),
                }),
            );
            let updater_acceptance_enabled =
                app.state::<app::updater::UpdaterAcceptance>().is_enabled();
            let telemetry_acceptance_enabled = app::install_counter::telemetry_acceptance_enabled();
            if telemetry_acceptance_enabled {
                app::install_counter::validate_telemetry_acceptance_identifier(
                    &app.config().identifier,
                )
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
            }
            let isolated_dev_instance = !is_official_app_identifier(&app.config().identifier);
            if isolated_dev_instance {
                let bridge_manager = app.state::<McpBridgeManager>();
                if let Ok(mut port) = bridge_manager.port.lock() {
                    *port = ISOLATED_DEV_MCP_PORT;
                };
            }
            let main_window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|config| config.label == "main")
                .cloned()
                .ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "missing main webview window configuration",
                    )
                })?;
            let mut main_window_builder =
                tauri::WebviewWindowBuilder::from_config(app.handle(), &main_window_config)?;
            if updater_acceptance_enabled {
                // Keep updater acceptance out of RAV's persistent WebKit profile.
                main_window_builder = main_window_builder
                    .incognito(true)
                    .initialization_script("window.__RAV_UPDATER_ACCEPTANCE__ = true;");
            } else if telemetry_acceptance_enabled {
                // Acceptance must share neither persistent browser state nor a
                // localhost bridge with a developer's active RAV instance.
                main_window_builder = main_window_builder.incognito(true).initialization_script(
                    app.state::<app::install_counter::telemetry_acceptance::TelemetryAcceptanceDriver>()
                        .initialization_script(),
                );
            } else if isolated_dev_instance {
                main_window_builder = main_window_builder
                    .incognito(true)
                    .initialization_script("window.__RAV_ISOLATED_DEV__ = true;");
            }
            let main_window = main_window_builder.build()?;
            record(app.handle(), "main_window.created", serde_json::json!({ "label": "main" }));
            // `create: false` lets setup choose the data store before WebKit exists.
            // Telemetry acceptance stays visible in the background so it does
            // not disrupt an active isolated DEV instance.
            main_window.show()?;
            record(app.handle(), "main_window.shown", serde_json::json!({ "label": "main" }));
            if app::install_counter::telemetry_acceptance::should_focus_main_window(
                telemetry_acceptance_enabled,
            ) {
                main_window.set_focus()?;
            }

            // Retire stale generated surfaces before any child WebView exists.
            let render_surface_manager = app.state::<RenderSurfaceManager>();
            if let Err(error) = app::render_surface::cleanup_render_surface_cache_on_startup(
                app.handle(),
                &render_surface_manager,
            ) {
                eprintln!("[rav-app] failed to clean stale render surfaces: {error}");
            }

            #[cfg(desktop)]
            {
                let menu = app::window::menu::build_desktop_menu(app.handle())?;
                app.set_menu(menu)?;
            }

            if let Some(_window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    if let Err(error) = hide_macos_traffic_lights(&_window) {
                        eprintln!("[rav-app] failed to hide macOS traffic lights: {error}");
                    }
                }
                #[cfg(target_os = "windows")]
                {
                    if let Err(error) = apply_windows_corner_preference(&_window) {
                        eprintln!("[rav-app] failed to apply Windows rounded corners: {error}");
                    }
                }
            }

            if let Err(error) = app::launch_services::refresh_for_installed_version(
                app.handle(),
                updater_acceptance_enabled,
                telemetry_acceptance_enabled,
            ) {
                eprintln!("[rav-app] failed to refresh Launch Services registration: {error}");
                record(app.handle(), "launch_services.refresh_failed", serde_json::json!({ "failed": true }));
            } else {
                record(app.handle(), "launch_services.refresh_complete", serde_json::json!({ "completed": true }));
            }

            let updater_acceptance = app.state::<app::updater::UpdaterAcceptance>();
            if updater_acceptance_enabled {
                updater_acceptance.write_launch_marker(app.handle())?;
            } else if telemetry_acceptance_enabled {
                // No MCP bridge or global MCP integration is allowed in this
                // deliberately telemetry-only acceptance launch.
                app::install_counter::schedule_on_launch(app.handle());
            } else {
                let bridge_manager = app.state::<McpBridgeManager>();
                if let Err(error) = initialize_mcp_bridge(app.handle(), &bridge_manager) {
                    eprintln!("[rav-app] failed to start MCP bridge: {error}");
                    record(app.handle(), "mcp.initialize_failed", serde_json::json!({ "failed": true }));
                } else {
                    record(app.handle(), "mcp.initialize_complete", serde_json::json!({ "completed": true }));
                }
                if !isolated_dev_instance {
                    if let Err(error) = refresh_mcp_client_launcher_if_present(app.handle()) {
                        eprintln!("[rav-app] failed to refresh MCP client launcher: {error}");
                    }
                    app::install_counter::schedule_on_launch(app.handle());
                }
            }
            record(
                app.handle(),
                "setup.complete",
                serde_json::json!({ "isolatedDev": isolated_dev_instance }),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app::demo_bundle::make_demo_bundle,
            app::demo_bundle::make_demo_bundle_to_path,
            app::isolated_playback::open_isolated_playback,
            app::install_counter::get_install_counter_status,
            app::install_counter::set_install_counter_enabled,
            app::install_counter::acknowledge_install_counter_notice,
            app::install_counter::telemetry_acceptance::complete_telemetry_acceptance_action,
            app::launch_services::get_riv_default_app_status,
            app::launch_services::make_rav_default_for_riv,
            app::mcp::commands::get_mcp_server_path,
            app::mcp::commands::get_mcp_port,
            app::mcp::commands::set_mcp_port,
            app::mcp::commands::stop_mcp_bridge,
            app::mcp::commands::get_mcp_setup_status,
            app::mcp::commands::install_mcp_client,
            app::mcp::commands::remove_mcp_client,
            app::node_runtime::detect_node_runtime,
            app::render_surface::create_render_surface,
            app::render_surface::set_render_surface_bounds,
            app::render_surface::show_render_surface,
            app::render_surface::hide_render_surface,
            app::render_surface::park_render_surface,
            app::render_surface::restore_render_surface,
            app::render_surface::close_render_surface,
            app::render_surface::activate_render_surface,
            app::render_surface::discard_render_surface,
            app::render_surface::send_render_surface_message,
            app::ui_overlay::show_ui_overlay,
            app::ui_overlay::restack_ui_overlay,
            app::ui_overlay::update_ui_overlay_state,
            app::ui_overlay::close_ui_overlay,
            app::ui_overlay::acknowledge_ui_overlay_adopted,
            app::ui_overlay::ui_overlay_ready,
            app::ui_overlay::submit_ui_overlay_action,
            app::ui_overlay::complete_ui_overlay_action,
            app::ui_overlay::is_ui_overlay_supported,
            app::updater::check_for_app_update,
            app::updater::get_updater_acceptance_config,
            app::updater::install_app_update,
            app::updater::relaunch_app,
            app::window::controls::open_devtools,
            app::window::controls::open_external_url,
            app::window::controls::pick_image_file,
            app::window::controls::pick_riv_file,
            app::operational_trace::get_rav_operational_trace,
            app::operational_trace::clear_rav_operational_trace,
            get_opened_file,
            read_riv_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                record(app, "process.exit", serde_json::json!({ "requested": true }));
                if let Some(manager) = app.try_state::<UiOverlayManager>() {
                    if let Err(error) = app::ui_overlay::close_all_ui_overlays(app, &manager) {
                        eprintln!("[rav-app] failed to close UI overlays on exit: {error}");
                    }
                }
                if let Some(manager) = app.try_state::<RenderSurfaceManager>() {
                    if let Err(error) =
                        app::render_surface::close_all_render_surfaces(app, &manager)
                    {
                        eprintln!("[rav-app] failed to retire render surfaces on exit: {error}");
                    }
                }
                let updater_acceptance_enabled = app
                    .try_state::<app::updater::UpdaterAcceptance>()
                    .is_some_and(|acceptance| acceptance.is_enabled());
                if !updater_acceptance_enabled
                    && !app::install_counter::telemetry_acceptance_enabled()
                {
                    if let Some(manager) = app.try_state::<McpBridgeManager>() {
                        kill_spawned_mcp_bridge(app, &manager);
                    }
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
                    record(app, "opened_file.ingress_drag_drop", serde_json::json!({ "fileName": file_basename(&value) }));
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
                    record(app, "opened_file.ingress_run_event", serde_json::json!({ "fileName": file_basename(&path) }));
                    queue_pending_opened_file(app, &path);
                    try_emit_open_file(app, path);
                }
            }
        });
}

#[tauri::command]
fn get_opened_file(app: tauri::AppHandle, state: tauri::State<'_, OpenedFiles>) -> Option<String> {
    let opened = state.0.lock().ok().and_then(|mut guard| guard.pop_front());
    if let Some(path) = opened.as_deref() {
        record(
            &app,
            "opened_file.dequeue",
            serde_json::json!({ "fileName": file_basename(path) }),
        );
    }
    opened
}

#[tauri::command]
fn read_riv_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::fs;

    if path.trim().is_empty() {
        record(
            &app,
            "opened_file.read_failed",
            serde_json::json!({ "reason": "empty_path" }),
        );
        return Err("File path is empty".into());
    }
    let file_name = file_basename(&path);
    let bytes = fs::read(&path).map_err(|error| {
        record(
            &app,
            "opened_file.read_failed",
            serde_json::json!({ "fileName": file_name.as_str(), "reason": "filesystem_read" }),
        );
        format!("Failed to read {}: {}", path, error)
    })?;
    record(
        &app,
        "opened_file.read_complete",
        serde_json::json!({ "fileName": file_name, "byteLength": bytes.len() }),
    );
    Ok(STANDARD.encode(&bytes))
}
