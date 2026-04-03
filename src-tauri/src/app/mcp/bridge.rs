use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

use tauri::Manager;
use toml_edit::Array;

use crate::app::constants::{DEFAULT_MCP_PORT, MCP_CLIENT_LAUNCHER_NAME};
use crate::app::state::McpBridgeManager;
use crate::app::support::{ensure_parent_directory, home_dir};

pub fn resolve_mcp_server_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let binary_name = if cfg!(target_os = "windows") {
        "rav-mcp.exe"
    } else {
        "rav-mcp"
    };

    let mut candidates = Vec::new();
    if let Ok(executable_dir) = app.path().executable_dir() {
        candidates.push(executable_dir.join(binary_name));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(binary_name));
        candidates.push(resource_dir.join("resources").join(binary_name));
    }

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| format!("MCP server not found in bundled sidecar locations for {}", binary_name))
}

pub fn mcp_client_launcher_path(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        return app
            .path()
            .app_data_dir()
            .map(|path| path.join("bin").join(format!("{MCP_CLIENT_LAUNCHER_NAME}.exe")))
            .map_err(|error| format!("Failed to resolve MCP launcher path: {}", error));
    }

    #[cfg(not(target_os = "windows"))]
    {
        return home_dir()
            .map(|path| path.join(".local").join("bin").join(MCP_CLIENT_LAUNCHER_NAME))
            .ok_or_else(|| "Failed to resolve home directory for MCP launcher".to_string());
    }
}

pub fn ensure_mcp_client_launcher(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled_server = resolve_mcp_server_path(app)?;
    let launcher_path = mcp_client_launcher_path(app)?;
    ensure_parent_directory(&launcher_path)?;

    #[cfg(target_os = "windows")]
    {
        let should_copy = fs::metadata(&launcher_path).map(|meta| meta.len()).ok()
            != fs::metadata(&bundled_server).map(|meta| meta.len()).ok();
        if should_copy {
            let _ = fs::remove_file(&launcher_path);
            fs::copy(&bundled_server, &launcher_path).map_err(|error| {
                format!(
                    "Failed to copy MCP launcher from {} to {}: {}",
                    bundled_server.display(),
                    launcher_path.display(),
                    error
                )
            })?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let needs_refresh = match fs::read_link(&launcher_path) {
            Ok(target) => target != bundled_server,
            Err(_) => true,
        };
        if needs_refresh {
            let _ = fs::remove_file(&launcher_path);
            std::os::unix::fs::symlink(&bundled_server, &launcher_path).map_err(|error| {
                format!(
                    "Failed to symlink MCP launcher from {} to {}: {}",
                    bundled_server.display(),
                    launcher_path.display(),
                    error
                )
            })?;
        }
    }

    Ok(launcher_path)
}

pub fn mcp_server_path_candidates(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let primary = ensure_mcp_client_launcher(app)?;
    let bundled = resolve_mcp_server_path(app)?;
    let mut paths = vec![primary];
    if !paths.iter().any(|path| path == &bundled) {
        paths.push(bundled);
    }
    Ok(paths)
}

pub fn normalize_mcp_port(port: Option<u16>) -> u16 {
    match port {
        Some(value) if value > 0 => value,
        _ => DEFAULT_MCP_PORT,
    }
}

pub fn build_mcp_args(port: u16) -> Vec<String> {
    vec!["--stdio-only".into(), "--port".into(), port.to_string()]
}

pub fn build_mcp_args_array(port: u16) -> Array {
    let mut args = Array::new();
    args.push("--stdio-only");
    args.push("--port");
    args.push(port.to_string());
    args
}

fn mcp_port_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("mcp-port.txt"))
        .map_err(|error| format!("Failed to resolve MCP config path: {}", error))
}

pub fn load_saved_mcp_port(app: &tauri::AppHandle) -> u16 {
    mcp_port_config_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .map(|port| normalize_mcp_port(Some(port)))
        .unwrap_or(DEFAULT_MCP_PORT)
}

pub fn persist_mcp_port(app: &tauri::AppHandle, port: u16) -> Result<(), String> {
    let normalized = normalize_mcp_port(Some(port));
    let path = mcp_port_config_path(app)?;
    ensure_parent_directory(&path)?;
    fs::write(&path, format!("{normalized}\n"))
        .map_err(|error| format!("Failed to write {}: {}", path.display(), error))
}

pub fn current_mcp_port(manager: &McpBridgeManager) -> Result<u16, String> {
    manager
        .port
        .lock()
        .map_err(|_| "Failed to read MCP port state".to_string())
        .map(|guard| *guard)
}

pub fn kill_spawned_mcp_bridge(manager: &McpBridgeManager) {
    if let Ok(mut child_guard) = manager.child.lock() {
        if let Some(mut child) = child_guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn spawn_mcp_bridge_sidecar(app: &tauri::AppHandle, port: u16) -> Result<Child, String> {
    let server_path = resolve_mcp_server_path(app)?;
    let port_text = normalize_mcp_port(Some(port)).to_string();
    Command::new(&server_path)
        .args(["--bridge-only", "--port", &port_text])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to start {}: {}", server_path.display(), error))
}

pub fn ensure_mcp_bridge_running(app: &tauri::AppHandle, manager: &McpBridgeManager) -> Result<u16, String> {
    let port = current_mcp_port(manager)?;
    let mut child_guard = manager
        .child
        .lock()
        .map_err(|_| "Failed to access MCP bridge process state".to_string())?;
    let should_spawn = match child_guard.as_mut() {
        Some(child) => child
            .try_wait()
            .map_err(|error| format!("Failed to inspect MCP bridge process: {}", error))?
            .is_some(),
        None => true,
    };

    if should_spawn {
        if let Some(mut child) = child_guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *child_guard = Some(spawn_mcp_bridge_sidecar(app, port)?);
    }

    Ok(port)
}

pub fn restart_mcp_bridge(app: &tauri::AppHandle, manager: &McpBridgeManager, port: u16) -> Result<u16, String> {
    let normalized = normalize_mcp_port(Some(port));
    {
        let mut port_guard = manager
            .port
            .lock()
            .map_err(|_| "Failed to update MCP port state".to_string())?;
        *port_guard = normalized;
    }
    kill_spawned_mcp_bridge(manager);
    ensure_mcp_bridge_running(app, manager)
}

pub fn initialize_mcp_bridge(app: &tauri::AppHandle, manager: &McpBridgeManager) -> Result<(), String> {
    let saved_port = load_saved_mcp_port(app);
    if let Ok(mut port_guard) = manager.port.lock() {
        *port_guard = saved_port;
    }
    ensure_mcp_bridge_running(app, manager).map(|_| ())
}

#[tauri::command]
pub fn get_mcp_server_path(app: tauri::AppHandle) -> Result<String, String> {
    resolve_mcp_server_path(&app).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_mcp_port(
    app: tauri::AppHandle,
    bridge_manager: tauri::State<'_, McpBridgeManager>,
) -> Result<u16, String> {
    let port = ensure_mcp_bridge_running(&app, &bridge_manager)?;
    Ok(port)
}

#[tauri::command]
pub fn set_mcp_port(
    app: tauri::AppHandle,
    bridge_manager: tauri::State<'_, McpBridgeManager>,
    port: u16,
) -> Result<u16, String> {
    let next_port = normalize_mcp_port(Some(port));
    persist_mcp_port(&app, next_port)?;
    restart_mcp_bridge(&app, &bridge_manager, next_port)
}

#[tauri::command]
pub fn stop_mcp_bridge(bridge_manager: tauri::State<'_, McpBridgeManager>) -> bool {
    kill_spawned_mcp_bridge(&bridge_manager);
    true
}
