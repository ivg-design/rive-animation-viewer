use crate::app::constants::is_official_app_identifier;
use crate::app::mcp::bridge::{
    current_mcp_port, ensure_mcp_bridge_running, ensure_mcp_client_launcher,
    kill_spawned_mcp_bridge, mcp_server_path_candidates, normalize_mcp_port_for_identifier,
    persist_mcp_port, resolve_mcp_server_path, restart_mcp_bridge,
};
use crate::app::mcp::client_config::build_mcp_targets;
use crate::app::mcp::client_install::{
    install_claude_code_mcp_with_port, install_claude_desktop_mcp_with_port,
    install_codex_mcp_with_port, remove_claude_code_mcp, remove_claude_desktop_mcp,
    remove_codex_mcp,
};
use crate::app::state::{McpBridgeManager, McpInstallResult, McpSetupStatus};
use crate::app::updater::UpdaterAcceptance;

fn require_mcp_available() -> Result<(), String> {
    if crate::app::install_counter::telemetry_acceptance_enabled() {
        return Err("MCP integration is disabled during telemetry acceptance".into());
    }
    Ok(())
}

fn require_official_mcp_client_integration(app: &tauri::AppHandle) -> Result<(), String> {
    if is_official_app_identifier(&app.config().identifier) {
        return Ok(());
    }
    Err("Global MCP client setup is disabled for isolated development instances".into())
}

#[tauri::command]
pub fn get_mcp_server_path(app: tauri::AppHandle) -> Result<String, String> {
    resolve_mcp_server_path(&app).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_mcp_port(
    app: tauri::AppHandle,
    bridge_manager: tauri::State<'_, McpBridgeManager>,
    updater_acceptance: tauri::State<'_, UpdaterAcceptance>,
) -> Result<u16, String> {
    require_mcp_available()?;
    if updater_acceptance.is_enabled() {
        current_mcp_port(&bridge_manager)
    } else {
        ensure_mcp_bridge_running(&app, &bridge_manager)
    }
}

#[tauri::command]
pub fn set_mcp_port(
    app: tauri::AppHandle,
    bridge_manager: tauri::State<'_, McpBridgeManager>,
    updater_acceptance: tauri::State<'_, UpdaterAcceptance>,
    port: u16,
) -> Result<u16, String> {
    require_mcp_available()?;
    if updater_acceptance.is_enabled() {
        return Err("MCP bridge changes are disabled during updater acceptance".into());
    }
    let next_port = normalize_mcp_port_for_identifier(&app.config().identifier, Some(port));
    persist_mcp_port(&app, next_port)?;
    restart_mcp_bridge(&app, &bridge_manager, next_port)
}

#[tauri::command]
pub fn stop_mcp_bridge(
    app: tauri::AppHandle,
    bridge_manager: tauri::State<'_, McpBridgeManager>,
    updater_acceptance: tauri::State<'_, UpdaterAcceptance>,
) -> bool {
    if require_mcp_available().is_err() {
        return false;
    }
    if !updater_acceptance.is_enabled() {
        kill_spawned_mcp_bridge(&app, &bridge_manager);
    }
    true
}

#[tauri::command]
pub fn get_mcp_setup_status(
    app: tauri::AppHandle,
    bridge_manager: tauri::State<'_, McpBridgeManager>,
    updater_acceptance: tauri::State<'_, UpdaterAcceptance>,
) -> Result<McpSetupStatus, String> {
    require_mcp_available()?;
    if updater_acceptance.is_enabled() {
        return Err("MCP integration is disabled during updater acceptance".into());
    }
    if !is_official_app_identifier(&app.config().identifier) {
        let server_path = resolve_mcp_server_path(&app)?;
        let port = current_mcp_port(&bridge_manager)?;
        return Ok(McpSetupStatus {
            server_path: server_path.to_string_lossy().to_string(),
            port,
            // Isolated builds may inspect their own bundled bridge, but must
            // never inspect or modify global client registrations.
            targets: vec![],
        });
    }
    let server_path = ensure_mcp_client_launcher(&app)?;
    let server_paths = mcp_server_path_candidates(&app)?;
    let port = current_mcp_port(&bridge_manager)?;
    Ok(McpSetupStatus {
        server_path: server_path.to_string_lossy().to_string(),
        port,
        targets: build_mcp_targets(&server_paths, port),
    })
}

#[tauri::command]
pub fn install_mcp_client(
    app: tauri::AppHandle,
    bridge_manager: tauri::State<'_, McpBridgeManager>,
    updater_acceptance: tauri::State<'_, UpdaterAcceptance>,
    target: String,
    port: Option<u16>,
) -> Result<McpInstallResult, String> {
    require_mcp_available()?;
    if updater_acceptance.is_enabled() {
        return Err("MCP integration is disabled during updater acceptance".into());
    }
    require_official_mcp_client_integration(&app)?;
    let server_path = ensure_mcp_client_launcher(&app)?;
    let port = normalize_mcp_port_for_identifier(
        &app.config().identifier,
        port.or_else(|| current_mcp_port(&bridge_manager).ok()),
    );
    match target.as_str() {
        "codex" => install_codex_mcp_with_port(&server_path, port),
        "claude-code" => install_claude_code_mcp_with_port(&server_path, port),
        "claude-desktop" => install_claude_desktop_mcp_with_port(&server_path, port),
        _ => Err(format!("Unsupported MCP target: {}", target)),
    }
}

#[tauri::command]
pub fn remove_mcp_client(
    app: tauri::AppHandle,
    updater_acceptance: tauri::State<'_, UpdaterAcceptance>,
    target: String,
) -> Result<McpInstallResult, String> {
    require_mcp_available()?;
    if updater_acceptance.is_enabled() {
        return Err("MCP integration is disabled during updater acceptance".into());
    }
    require_official_mcp_client_integration(&app)?;
    match target.as_str() {
        "codex" => remove_codex_mcp(),
        "claude-code" => remove_claude_code_mcp(),
        "claude-desktop" => remove_claude_desktop_mcp(),
        _ => Err(format!("Unsupported MCP target: {}", target)),
    }
}
