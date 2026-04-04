use crate::app::mcp::bridge::{
    current_mcp_port,
    ensure_mcp_client_launcher,
    mcp_server_path_candidates,
    normalize_mcp_port,
};
use crate::app::mcp::client_config::build_mcp_targets;
use crate::app::mcp::client_install::{
    install_claude_code_mcp_with_port,
    install_claude_desktop_mcp_with_port,
    install_codex_mcp_with_port,
    remove_claude_code_mcp,
    remove_claude_desktop_mcp,
    remove_codex_mcp,
};
use crate::app::state::{McpBridgeManager, McpInstallResult, McpSetupStatus};

#[tauri::command]
pub fn get_mcp_setup_status(
    app: tauri::AppHandle,
    bridge_manager: tauri::State<'_, McpBridgeManager>,
) -> Result<McpSetupStatus, String> {
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
    target: String,
    port: Option<u16>,
) -> Result<McpInstallResult, String> {
    let server_path = ensure_mcp_client_launcher(&app)?;
    let port = normalize_mcp_port(port.or_else(|| current_mcp_port(&bridge_manager).ok()));
    match target.as_str() {
        "codex" => install_codex_mcp_with_port(&server_path, port),
        "claude-code" => install_claude_code_mcp_with_port(&server_path, port),
        "claude-desktop" => install_claude_desktop_mcp_with_port(&server_path, port),
        _ => Err(format!("Unsupported MCP target: {}", target)),
    }
}

#[tauri::command]
pub fn remove_mcp_client(target: String) -> Result<McpInstallResult, String> {
    match target.as_str() {
        "codex" => remove_codex_mcp(),
        "claude-code" => remove_claude_code_mcp(),
        "claude-desktop" => remove_claude_desktop_mcp(),
        _ => Err(format!("Unsupported MCP target: {}", target)),
    }
}
