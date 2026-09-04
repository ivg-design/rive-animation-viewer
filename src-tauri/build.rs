fn main() {
    println!("cargo:rerun-if-env-changed=RAV_ALLOW_ISOLATED_DEFAULT_APP_TEST");
    println!("cargo:rerun-if-env-changed=RAV_TELEMETRY_ACCEPTANCE");
    println!("cargo:rerun-if-env-changed=RAV_TELEMETRY_ACCEPTANCE_ENDPOINT");
    println!("cargo:rerun-if-env-changed=RAV_COUNTER_ENDPOINT");
    println!("cargo:rerun-if-env-changed=RAV_OFFICIAL_RELEASE");
    configure_telemetry_acceptance();
    const COMMANDS: &[&str] = &[
        "media_export_capabilities",
        "media_export_choose_path",
        "media_export_begin",
        "media_export_frame",
        "media_export_finish",
        "media_export_status",
        "media_export_cancel",
        "media_export_abort",
        "make_demo_bundle",
        "make_demo_bundle_to_path",
        "open_isolated_playback",
        "get_install_counter_status",
        "set_install_counter_enabled",
        "acknowledge_install_counter_notice",
        "complete_telemetry_acceptance_action",
        "get_riv_default_app_status",
        "make_rav_default_for_riv",
        "get_mcp_server_path",
        "get_mcp_port",
        "set_mcp_port",
        "stop_mcp_bridge",
        "get_mcp_setup_status",
        "install_mcp_client",
        "remove_mcp_client",
        "detect_node_runtime",
        "create_render_surface",
        "set_render_surface_bounds",
        "show_render_surface",
        "hide_render_surface",
        "park_render_surface",
        "restore_render_surface",
        "close_render_surface",
        "activate_render_surface",
        "discard_render_surface",
        "send_render_surface_message",
        "show_ui_overlay",
        "restack_ui_overlay",
        "update_ui_overlay_state",
        "close_ui_overlay",
        "acknowledge_ui_overlay_adopted",
        "ui_overlay_ready",
        "submit_ui_overlay_action",
        "complete_ui_overlay_action",
        "is_ui_overlay_supported",
        "check_for_app_update",
        "get_updater_acceptance_config",
        "install_app_update",
        "relaunch_app",
        "open_devtools",
        "open_external_url",
        "pick_image_file",
        "pick_riv_file",
        "get_rav_operational_trace",
        "clear_rav_operational_trace",
        "get_opened_file",
        "read_riv_file",
    ];
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if let Err(error) = tauri_build::try_build(attributes) {
        panic!("Tauri build configuration failed: {error:#}");
    }
}

/// Acceptance telemetry is deliberately a compile-time, release-only opt-in.
/// It uses a separate endpoint variable so normal DEV and official builds can
/// never acquire an acceptance endpoint merely from their runtime environment.
fn configure_telemetry_acceptance() {
    use std::env;

    let enabled = env::var("RAV_TELEMETRY_ACCEPTANCE").ok();
    let endpoint = env::var("RAV_TELEMETRY_ACCEPTANCE_ENDPOINT").ok();
    match (enabled.as_deref(), endpoint.as_deref()) {
        (None, None) => return,
        (Some("1"), Some(endpoint)) if !endpoint.trim().is_empty() => {}
        _ => panic!(
            "RAV_TELEMETRY_ACCEPTANCE=1 and RAV_TELEMETRY_ACCEPTANCE_ENDPOINT are both required for telemetry acceptance"
        ),
    }

    if env::var("RAV_OFFICIAL_RELEASE").ok().as_deref() == Some("1") {
        panic!("telemetry acceptance cannot be compiled as an official release");
    }
    if env::var("RAV_COUNTER_ENDPOINT").ok().as_deref() == endpoint.as_deref() {
        panic!(
            "telemetry acceptance endpoint must differ from RAV_COUNTER_ENDPOINT to protect production telemetry"
        );
    }

    let endpoint = endpoint.expect("validated above");
    println!("cargo:rustc-env=RAV_TELEMETRY_ACCEPTANCE_BUILD=1");
    println!("cargo:rustc-env=RAV_TELEMETRY_ACCEPTANCE_BUILD_ENDPOINT={endpoint}");
}
