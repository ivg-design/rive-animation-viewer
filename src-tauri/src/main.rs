// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::collections::VecDeque;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind, HELP_SUBMENU_ID};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use toml_edit::{value, Array, DocumentMut, Item};

const DEFAULT_MCP_PORT: u16 = 9274;
const APP_UPDATE_TIMEOUT_SECS: u64 = 30;
const ONLINE_DOCS_MENU_ID: &str = "rav-online-docs";
const RAV_DOCS_URL: &str = "https://forge.mograph.life/apps/rav/docs";
const MCP_CLIENT_LAUNCHER_NAME: &str = "rav-mcp-rav";

#[derive(Clone)]
struct JsonMcpServerEntry {
    scope_label: String,
    command: Option<String>,
    args: Vec<String>,
}

#[derive(Deserialize)]
struct DemoBundlePayload {
    file_name: String,
    animation_base64: String,
    runtime_name: String,
    runtime_version: Option<String>,
    runtime_script: String,
    autoplay: bool,
    layout_alignment: String,
    layout_fit: String,
    state_machines: Vec<String>,
    #[serde(default)]
    animations: Vec<String>,
    artboard_name: Option<String>,
    canvas_color: Option<String>,
    #[serde(default)]
    canvas_transparent: bool,
    #[serde(default)]
    control_snapshot: Option<String>,
    #[serde(default)]
    default_instantiation_package_source: String,
    #[serde(default)]
    instantiation_code: String,
    #[serde(default)]
    instantiation_snippets: Option<String>,
    #[serde(default)]
    instantiation_source_mode: String,
    layout_state: Option<String>,
    vm_hierarchy: Option<String>,
}

// State: queue of file paths passed via Open With / double click.
struct OpenedFiles(Mutex<VecDeque<String>>);

struct McpBridgeManager {
    child: Mutex<Option<Child>>,
    port: Mutex<u16>,
}

impl McpBridgeManager {
    fn new(port: u16) -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(port),
        }
    }
}

#[derive(Default)]
struct PendingAppUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
struct WindowCursorPosition {
    x: f64,
    y: f64,
}

#[derive(Serialize)]
struct NodeRuntimeStatus {
    installed: bool,
    path: Option<String>,
    version: Option<String>,
    source: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateStatus {
    available: bool,
    current_version: String,
    version: Option<String>,
    body: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateInstallResult {
    installed: bool,
    version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpClientStatus {
    id: String,
    label: String,
    available: bool,
    installed: bool,
    configured: bool,
    method: String,
    cli_path: Option<String>,
    config_path: Option<String>,
    detail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpSetupStatus {
    server_path: String,
    port: u16,
    targets: Vec<McpClientStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpInstallResult {
    target: String,
    installed: bool,
    detail: String,
}

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

fn resolve_mcp_server_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

    if let Some(found) = candidates.into_iter().find(|path| path.exists()) {
        Ok(found)
    } else {
        Err(format!("MCP server not found in bundled sidecar locations for {}", binary_name))
    }
}

fn mcp_client_launcher_path(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

fn ensure_mcp_client_launcher(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled_server = resolve_mcp_server_path(app)?;
    let launcher_path = mcp_client_launcher_path(app)?;
    ensure_parent_directory(&launcher_path)?;

    #[cfg(target_os = "windows")]
    {
        let should_copy = fs::metadata(&launcher_path)
            .map(|meta| meta.len())
            .ok()
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

fn mcp_server_path_candidates(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let primary = ensure_mcp_client_launcher(app)?;
    let bundled = resolve_mcp_server_path(app)?;
    let mut paths = vec![primary];
    if !paths.iter().any(|path| path == &bundled) {
        paths.push(bundled);
    }
    Ok(paths)
}

fn normalize_mcp_port(port: Option<u16>) -> u16 {
    match port {
        Some(value) if value > 0 => value,
        _ => DEFAULT_MCP_PORT,
    }
}

fn build_mcp_args(port: u16) -> Vec<String> {
    vec!["--stdio-only".into(), "--port".into(), port.to_string()]
}

fn build_mcp_args_array(port: u16) -> Array {
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

fn load_saved_mcp_port(app: &tauri::AppHandle) -> u16 {
    mcp_port_config_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .map(|port| normalize_mcp_port(Some(port)))
        .unwrap_or(DEFAULT_MCP_PORT)
}

fn persist_mcp_port(app: &tauri::AppHandle, port: u16) -> Result<(), String> {
    let normalized = normalize_mcp_port(Some(port));
    let path = mcp_port_config_path(app)?;
    ensure_parent_directory(&path)?;
    fs::write(&path, format!("{normalized}\n"))
        .map_err(|error| format!("Failed to write {}: {}", path.display(), error))
}

fn current_mcp_port(manager: &McpBridgeManager) -> Result<u16, String> {
    manager
        .port
        .lock()
        .map_err(|_| "Failed to read MCP port state".to_string())
        .map(|guard| *guard)
}

fn kill_spawned_mcp_bridge(manager: &McpBridgeManager) {
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

fn ensure_mcp_bridge_running(app: &tauri::AppHandle, manager: &McpBridgeManager) -> Result<u16, String> {
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

fn restart_mcp_bridge(app: &tauri::AppHandle, manager: &McpBridgeManager, port: u16) -> Result<u16, String> {
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

#[tauri::command]
fn get_mcp_server_path(app: tauri::AppHandle) -> Result<String, String> {
    resolve_mcp_server_path(&app).map(|path| path.to_string_lossy().to_string())
}

fn normalize_node_version(output: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(output);
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

fn try_node_at_path(path: &Path, source: &str) -> Option<NodeRuntimeStatus> {
    if !path.exists() {
        return None;
    }

    let output = Command::new(path).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }

    let version =
        normalize_node_version(&output.stdout).or_else(|| normalize_node_version(&output.stderr));

    Some(NodeRuntimeStatus {
        installed: true,
        path: Some(path.to_string_lossy().to_string()),
        version,
        source: Some(source.to_string()),
    })
}

fn candidate_node_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let binary_name = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    if let Some(path_var) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path_var).map(|entry| entry.join(binary_name)));
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/node"));
        candidates.push(PathBuf::from("/usr/local/bin/node"));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/node"));
        candidates.push(PathBuf::from("/usr/local/bin/node"));
    }

    let mut seen = HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.clone()));
    candidates
}

fn detect_node_via_shell() -> Option<NodeRuntimeStatus> {
    #[cfg(target_os = "windows")]
    let output = Command::new("cmd")
        .args(["/C", "where node && node --version"])
        .output()
        .ok()?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("/bin/zsh")
        .args(["-lc", "command -v node && node --version"])
        .output()
        .or_else(|_| {
            Command::new("/bin/sh")
                .args(["-lc", "command -v node && node --version"])
                .output()
        })
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let lines: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect();

    let path = lines.iter().find(|line| line.contains("node")).cloned();
    let version = lines
        .iter()
        .find(|line| {
            line.starts_with('v')
                || line
                    .chars()
                    .next()
                    .map(|char| char.is_ascii_digit())
                    .unwrap_or(false)
        })
        .cloned();

    Some(NodeRuntimeStatus {
        installed: path.is_some() || version.is_some(),
        path,
        version,
        source: Some("login-shell".into()),
    })
}

#[tauri::command]
fn detect_node_runtime() -> NodeRuntimeStatus {
    for candidate in candidate_node_paths() {
        if let Some(status) = try_node_at_path(&candidate, "path-search") {
            return status;
        }
    }

    if let Some(status) = detect_node_via_shell() {
        return status;
    }

    NodeRuntimeStatus {
        installed: false,
        path: None,
        version: None,
        source: None,
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

#[cfg(target_os = "windows")]
fn appdata_dir() -> Option<PathBuf> {
    env::var_os("APPDATA").map(PathBuf::from)
}

fn codex_config_path() -> Option<PathBuf> {
    home_dir().map(|path| path.join(".codex").join("config.toml"))
}

fn claude_desktop_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return home_dir().map(|path| {
            path.join("Library")
                .join("Application Support")
                .join("Claude")
                .join("claude_desktop_config.json")
        });
    }

    #[cfg(target_os = "windows")]
    {
        return appdata_dir()
            .map(|path| path.join("Claude").join("claude_desktop_config.json"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return home_dir().map(|path| {
            path.join(".config")
                .join("Claude")
                .join("claude_desktop_config.json")
        });
    }
}

fn command_candidates(command: &str) -> Vec<PathBuf> {
    let binary_name = if cfg!(target_os = "windows") {
        format!("{command}.exe")
    } else {
        command.to_string()
    };

    let mut candidates = Vec::new();
    if let Some(path_var) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path_var).map(|entry| entry.join(&binary_name)));
    }

    if let Some(home) = home_dir() {
        candidates.push(home.join(".local").join("bin").join(&binary_name));
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin").join(&binary_name));
        candidates.push(PathBuf::from("/usr/local/bin").join(&binary_name));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            candidates.push(
                local_app_data
                    .join("Programs")
                    .join(command)
                    .join(&binary_name),
            );
        }
    }

    let mut seen = HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.clone()));
    candidates
}

fn find_command_path(command: &str) -> Option<PathBuf> {
    command_candidates(command)
        .into_iter()
        .find(|candidate| candidate.exists())
}

fn codex_server_status(path: &Path, server_path: &Path, expected_args: &[String]) -> (bool, bool) {
    let Ok(raw) = fs::read_to_string(path) else {
        return (false, false);
    };
    let Ok(doc) = raw.parse::<DocumentMut>() else {
        return (false, false);
    };
    let Some(server) = doc.get("mcp_servers").and_then(|item| item.get("rav-mcp")) else {
        return (false, false);
    };

    let command_matches = server
        .get("command")
        .and_then(Item::as_str)
        .map(|value| value == server_path.to_string_lossy())
        .unwrap_or(false);
    let args_matches = server
        .get("args")
        .and_then(Item::as_array)
        .map(|args| {
            args.iter()
                .filter_map(|item| item.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>()
                == expected_args
        })
        .unwrap_or(false);

    (true, command_matches && args_matches)
}

fn command_and_args_match(
    command: Option<&str>,
    args: &[String],
    server_paths: &[PathBuf],
    expected_args: &[String],
) -> bool {
    command
        .map(|value| server_paths.iter().any(|path| value == path.to_string_lossy()))
        .unwrap_or(false)
        && args == expected_args
}

fn claude_desktop_server_status(
    path: &Path,
    server_paths: &[PathBuf],
    expected_args: &[String],
) -> (bool, bool) {
    let Ok(raw) = fs::read_to_string(path) else {
        return (false, false);
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return (false, false);
    };
    let Some(server) = value
        .get("mcpServers")
        .and_then(serde_json::Value::as_object)
        .and_then(|servers| servers.get("rav-mcp"))
    else {
        return (false, false);
    };

    let command_matches = server
        .get("command")
        .and_then(serde_json::Value::as_str)
        .map(|value| server_paths.iter().any(|path| value == path.to_string_lossy()))
        .unwrap_or(false);
    let args_matches = server
        .get("args")
        .and_then(serde_json::Value::as_array)
        .map(|args| {
            args.iter()
                .filter_map(serde_json::Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
                == expected_args
        })
        .unwrap_or(false);

    (true, command_matches && args_matches)
}

fn claude_code_config_path() -> Option<PathBuf> {
    home_dir().map(|path| path.join(".claude.json"))
}

fn claude_code_server_entries(path: &Path) -> Vec<JsonMcpServerEntry> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let mut entries = Vec::new();

    let push_entry = |entries: &mut Vec<JsonMcpServerEntry>, scope_label: String, server: &serde_json::Value| {
        let command = server
            .get("command")
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned);
        let args = server
            .get("args")
            .and_then(serde_json::Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        entries.push(JsonMcpServerEntry {
            scope_label,
            command,
            args,
        });
    };

    if let Some(server) = value
        .get("mcpServers")
        .and_then(serde_json::Value::as_object)
        .and_then(|servers| servers.get("rav-mcp"))
    {
        push_entry(&mut entries, "User scope".into(), server);
    }

    if let Some(root) = value.as_object() {
        for (key, project_value) in root {
            if !key.starts_with('/') {
                continue;
            }
            let Some(server) = project_value
                .get("mcpServers")
                .and_then(serde_json::Value::as_object)
                .and_then(|servers| servers.get("rav-mcp"))
            else {
                continue;
            };
            push_entry(&mut entries, format!("Project scope ({key})"), server);
        }
    }

    entries
}

fn claude_code_server_status(
    path: &Path,
    server_paths: &[PathBuf],
    expected_args: &[String],
) -> (bool, bool, Option<String>) {
    let entries = claude_code_server_entries(path);
    if entries.is_empty() {
        return (false, false, None);
    }

    let mut matching_scopes = Vec::new();
    let mut conflicting_scopes = Vec::new();
    for entry in &entries {
        if command_and_args_match(entry.command.as_deref(), &entry.args, server_paths, expected_args) {
            matching_scopes.push(entry.scope_label.clone());
        } else {
            conflicting_scopes.push(entry.scope_label.clone());
        }
    }

    let mut detail_parts = Vec::new();
    if !matching_scopes.is_empty() {
        detail_parts.push(format!("Configured in {}", matching_scopes.join(", ")));
    }
    if !conflicting_scopes.is_empty() {
        detail_parts.push(format!("Different rav-mcp config in {}", conflicting_scopes.join(", ")));
    }

    (
        true,
        !matching_scopes.is_empty(),
        if detail_parts.is_empty() {
            None
        } else {
            Some(detail_parts.join(" • "))
        },
    )
}

fn build_mcp_targets(server_paths: &[PathBuf], port: u16) -> Vec<McpClientStatus> {
    let expected_args = build_mcp_args(port);
    let codex_config = codex_config_path();
    let codex_cli = find_command_path("codex");
    let codex_available = codex_config.is_some() || codex_cli.is_some();
    let (codex_installed, codex_configured) = codex_config
        .as_deref()
        .map(|path| codex_server_status(path, &server_paths[0], &expected_args))
        .unwrap_or((false, false));

    let claude_code_cli = find_command_path("claude");
    let claude_code_config = claude_code_config_path();
    let claude_code_available = claude_code_cli.is_some()
        || claude_code_config
        .as_deref()
        .map(Path::exists)
        .unwrap_or(false);
    let (claude_code_installed, claude_code_configured, claude_code_detail) = claude_code_config
        .as_deref()
        .map(|path| claude_code_server_status(path, server_paths, &expected_args))
        .unwrap_or((false, false, None));

    let claude_desktop_config = claude_desktop_config_path();
    let claude_desktop_available = claude_desktop_config
        .as_deref()
        .and_then(Path::parent)
        .map(Path::exists)
        .unwrap_or(false)
        || claude_desktop_config
            .as_deref()
            .map(Path::exists)
            .unwrap_or(false);
    let (claude_desktop_installed, claude_desktop_configured) = claude_desktop_config
        .as_deref()
        .map(|path| claude_desktop_server_status(path, server_paths, &expected_args))
        .unwrap_or((false, false));

    vec![
        McpClientStatus {
            id: "codex".into(),
            label: "Codex".into(),
            available: codex_available,
            installed: codex_installed,
            configured: codex_configured,
            method: "config-file".into(),
            cli_path: codex_cli.map(|path| path.to_string_lossy().to_string()),
            config_path: codex_config.map(|path| path.to_string_lossy().to_string()),
            detail: Some("Shared Codex config for CLI/Desktop".into()),
        },
        McpClientStatus {
            id: "claude-code".into(),
            label: "Claude Code".into(),
            available: claude_code_available,
            installed: claude_code_installed,
            configured: claude_code_configured,
            method: "config-file".into(),
            cli_path: claude_code_cli.map(|path| path.to_string_lossy().to_string()),
            config_path: claude_code_config.map(|path| path.to_string_lossy().to_string()),
            detail: claude_code_detail.or_else(|| Some("Claude Code user and project config".into())),
        },
        McpClientStatus {
            id: "claude-desktop".into(),
            label: "Claude Desktop".into(),
            available: claude_desktop_available,
            installed: claude_desktop_installed,
            configured: claude_desktop_configured,
            method: "config-file".into(),
            cli_path: None,
            config_path: claude_desktop_config.map(|path| path.to_string_lossy().to_string()),
            detail: Some("Desktop app config file".into()),
        },
    ]
}

fn ensure_parent_directory(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {}", parent.display(), error))?;
    }
    Ok(())
}

fn install_codex_mcp_with_port(server_path: &Path, port: u16) -> Result<McpInstallResult, String> {
    let config_path = codex_config_path().ok_or_else(|| "Codex config path could not be resolved".to_string())?;
    ensure_parent_directory(&config_path)?;

    let raw = fs::read_to_string(&config_path).unwrap_or_default();
    let mut doc = raw.parse::<DocumentMut>().unwrap_or_default();
    let args = build_mcp_args_array(port);

    doc["mcp_servers"]["rav-mcp"]["command"] = value(server_path.to_string_lossy().to_string());
    doc["mcp_servers"]["rav-mcp"]["args"] = value(args);

    fs::write(&config_path, doc.to_string())
        .map_err(|error| format!("Failed to write {}: {}", config_path.display(), error))?;

    Ok(McpInstallResult {
        target: "codex".into(),
        installed: true,
        detail: format!("Installed rav-mcp into {}", config_path.display()),
    })
}

fn install_claude_desktop_mcp_with_port(server_path: &Path, port: u16) -> Result<McpInstallResult, String> {
    let config_path = claude_desktop_config_path()
        .ok_or_else(|| "Claude Desktop config path could not be resolved".to_string())?;
    ensure_parent_directory(&config_path)?;

    let mut root = fs::read_to_string(&config_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if !root.is_object() {
        root = serde_json::json!({});
    }

    let root_obj = root
        .as_object_mut()
        .ok_or_else(|| "Claude Desktop config is not a JSON object".to_string())?;

    let servers = root_obj
        .entry("mcpServers".to_string())
        .or_insert_with(|| serde_json::json!({}));

    if !servers.is_object() {
        *servers = serde_json::json!({});
    }

    let Some(servers_obj) = servers.as_object_mut() else {
        return Err("Claude Desktop MCP config is not an object".into());
    };

    servers_obj.insert(
        "rav-mcp".into(),
        serde_json::json!({
            "command": server_path.to_string_lossy().to_string(),
            "args": build_mcp_args(port)
        }),
    );

    let formatted =
        serde_json::to_string_pretty(&root).map_err(|error| format!("Failed to encode JSON: {}", error))?;
    fs::write(&config_path, format!("{formatted}\n"))
        .map_err(|error| format!("Failed to write {}: {}", config_path.display(), error))?;

    Ok(McpInstallResult {
        target: "claude-desktop".into(),
        installed: true,
        detail: format!("Installed rav-mcp into {}", config_path.display()),
    })
}

fn remove_claude_code_entries(root: &mut serde_json::Value) {
    if let Some(root_obj) = root.as_object_mut() {
        if let Some(servers) = root_obj
            .get_mut("mcpServers")
            .and_then(serde_json::Value::as_object_mut)
        {
            servers.remove("rav-mcp");
        }
        for (key, value) in root_obj.iter_mut() {
            if !key.starts_with('/') {
                continue;
            }
            if let Some(servers) = value
                .get_mut("mcpServers")
                .and_then(serde_json::Value::as_object_mut)
            {
                servers.remove("rav-mcp");
            }
        }
    }
}

fn install_claude_code_mcp_with_port(server_path: &Path, port: u16) -> Result<McpInstallResult, String> {
    let config_path =
        claude_code_config_path().ok_or_else(|| "Claude Code config path could not be resolved".to_string())?;
    ensure_parent_directory(&config_path)?;
    let mut root = fs::read_to_string(&config_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !root.is_object() {
        root = serde_json::json!({});
    }

    remove_claude_code_entries(&mut root);
    let root_obj = root
        .as_object_mut()
        .ok_or_else(|| "Claude Code config is not a JSON object".to_string())?;
    let servers = root_obj
        .entry("mcpServers".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !servers.is_object() {
        *servers = serde_json::json!({});
    }
    let Some(servers_obj) = servers.as_object_mut() else {
        return Err("Claude Code MCP config is not an object".into());
    };
    servers_obj.insert(
        "rav-mcp".into(),
        serde_json::json!({
            "type": "stdio",
            "command": server_path.to_string_lossy().to_string(),
            "args": build_mcp_args(port),
        }),
    );
    let formatted =
        serde_json::to_string_pretty(&root).map_err(|error| format!("Failed to encode JSON: {}", error))?;
    fs::write(&config_path, format!("{formatted}\n"))
        .map_err(|error| format!("Failed to write {}: {}", config_path.display(), error))?;

    Ok(McpInstallResult {
        target: "claude-code".into(),
        installed: true,
        detail: format!("Installed rav-mcp into {}", config_path.display()),
    })
}

fn remove_codex_mcp() -> Result<McpInstallResult, String> {
    let config_path = codex_config_path().ok_or_else(|| "Codex config path could not be resolved".to_string())?;
    let raw = fs::read_to_string(&config_path).unwrap_or_default();
    let mut doc = raw.parse::<DocumentMut>().unwrap_or_default();

    if let Some(mcp_servers) = doc.get_mut("mcp_servers").and_then(|item| item.as_table_like_mut()) {
        mcp_servers.remove("rav-mcp");
    }

    fs::write(&config_path, doc.to_string())
        .map_err(|error| format!("Failed to write {}: {}", config_path.display(), error))?;

    Ok(McpInstallResult {
        target: "codex".into(),
        installed: false,
        detail: format!("Removed rav-mcp from {}", config_path.display()),
    })
}

fn remove_claude_desktop_mcp() -> Result<McpInstallResult, String> {
    let config_path = claude_desktop_config_path()
        .ok_or_else(|| "Claude Desktop config path could not be resolved".to_string())?;

    let mut root = fs::read_to_string(&config_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if let Some(root_obj) = root.as_object_mut() {
        if let Some(servers) = root_obj.get_mut("mcpServers").and_then(serde_json::Value::as_object_mut) {
            servers.remove("rav-mcp");
        }
    }

    let formatted =
        serde_json::to_string_pretty(&root).map_err(|error| format!("Failed to encode JSON: {}", error))?;
    fs::write(&config_path, format!("{formatted}\n"))
        .map_err(|error| format!("Failed to write {}: {}", config_path.display(), error))?;

    Ok(McpInstallResult {
        target: "claude-desktop".into(),
        installed: false,
        detail: format!("Removed rav-mcp from {}", config_path.display()),
    })
}

fn remove_claude_code_mcp() -> Result<McpInstallResult, String> {
    let config_path =
        claude_code_config_path().ok_or_else(|| "Claude Code config path could not be resolved".to_string())?;
    let mut root = fs::read_to_string(&config_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !root.is_object() {
        root = serde_json::json!({});
    }
    remove_claude_code_entries(&mut root);
    let formatted =
        serde_json::to_string_pretty(&root).map_err(|error| format!("Failed to encode JSON: {}", error))?;
    fs::write(&config_path, format!("{formatted}\n"))
        .map_err(|error| format!("Failed to write {}: {}", config_path.display(), error))?;

    Ok(McpInstallResult {
        target: "claude-code".into(),
        installed: false,
        detail: format!("Removed rav-mcp from {}", config_path.display()),
    })
}

#[tauri::command]
fn get_mcp_setup_status(
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
fn install_mcp_client(
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
fn remove_mcp_client(target: String) -> Result<McpInstallResult, String> {
    match target.as_str() {
        "codex" => remove_codex_mcp(),
        "claude-code" => remove_claude_code_mcp(),
        "claude-desktop" => remove_claude_desktop_mcp(),
        _ => Err(format!("Unsupported MCP target: {}", target)),
    }
}

#[tauri::command]
fn get_mcp_port(
    app: tauri::AppHandle,
    bridge_manager: tauri::State<'_, McpBridgeManager>,
) -> Result<u16, String> {
    let port = ensure_mcp_bridge_running(&app, &bridge_manager)?;
    Ok(port)
}

#[tauri::command]
fn set_mcp_port(
    app: tauri::AppHandle,
    bridge_manager: tauri::State<'_, McpBridgeManager>,
    port: u16,
) -> Result<u16, String> {
    let next_port = normalize_mcp_port(Some(port));
    persist_mcp_port(&app, next_port)?;
    restart_mcp_bridge(&app, &bridge_manager, next_port)
}

#[tauri::command]
fn stop_mcp_bridge(bridge_manager: tauri::State<'_, McpBridgeManager>) -> bool {
    kill_spawned_mcp_bridge(&bridge_manager);
    true
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Only http(s) URLs are supported".into());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(trimmed);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", trimmed]);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(trimmed);
        cmd
    };

    command
        .status()
        .map_err(|error| error.to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(format!("Failed to open {trimmed}"))
            }
        })
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
        .map_err(|error| error.to_string())?;

    #[cfg(desktop)]
    {
        // Transparent overlays look cleaner without the native window shadow.
        if let Err(error) = window.set_shadow(!enabled) {
            eprintln!("failed to set window shadow: {error}");
        }
    }

    Ok(())
}

#[tauri::command]
fn set_window_click_through(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_window_click_through_mode(
    window: tauri::WebviewWindow,
    enabled: bool,
) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|error| error.to_string())?;
    if !enabled {
        let _ = window.set_ignore_cursor_events(false);
    }
    Ok(())
}

#[tauri::command]
fn get_window_cursor_position(window: tauri::WebviewWindow) -> Option<WindowCursorPosition> {
    window
        .cursor_position()
        .ok()
        .map(|position| WindowCursorPosition {
            x: position.x,
            y: position.y,
        })
}

#[tauri::command]
async fn check_for_app_update(
    app: tauri::AppHandle,
    pending_update: tauri::State<'_, PendingAppUpdate>,
) -> Result<AppUpdateStatus, String> {
    let updater = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(APP_UPDATE_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;
    let current_version = app.package_info().version.to_string();
    let update = updater.check().await.map_err(|error| error.to_string())?;

    let mut pending_guard = pending_update.0.lock().map_err(|error| error.to_string())?;
    *pending_guard = update;

    Ok(match pending_guard.as_ref() {
        Some(update) => AppUpdateStatus {
            available: true,
            current_version,
            version: Some(update.version.clone()),
            body: update.body.clone(),
        },
        None => AppUpdateStatus {
            available: false,
            current_version,
            version: None,
            body: None,
        },
    })
}

#[tauri::command]
async fn install_app_update(
    pending_update: tauri::State<'_, PendingAppUpdate>,
) -> Result<AppUpdateInstallResult, String> {
    let update = {
        let mut pending_guard = pending_update.0.lock().map_err(|error| error.to_string())?;
        pending_guard.take()
    };

    let Some(update) = update else {
        return Ok(AppUpdateInstallResult {
            installed: false,
            version: None,
        });
    };

    let version = update.version.clone();

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    Ok(AppUpdateInstallResult {
        installed: true,
        version: Some(version),
    })
}

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) -> bool {
    app.request_restart();
    true
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

#[tauri::command]
async fn make_demo_bundle_to_path(
    payload: DemoBundlePayload,
    output_path: String,
) -> Result<String, String> {
    if output_path.trim().is_empty() {
        return Err("output_path is empty".into());
    }
    let path = std::path::PathBuf::from(&output_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
    }
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
      "controlSnapshot": payload
        .control_snapshot
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .unwrap_or_else(|| json!([])),
      "defaultInstantiationPackageSource": if payload.default_instantiation_package_source.trim().eq_ignore_ascii_case("local") {
        "local"
      } else {
        "cdn"
      },
      "instantiationCode": payload.instantiation_code,
      "instantiationSnippets": payload
        .instantiation_snippets
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .unwrap_or_else(|| json!({})),
      "instantiationSourceMode": payload.instantiation_source_mode,
      "layoutAlignment": payload.layout_alignment,
      "layoutFit": payload.layout_fit,
      "stateMachines": payload.state_machines,
      "animations": payload.animations,
      "artboardName": payload.artboard_name,
      "canvasColor": payload
        .canvas_color
        .clone()
        .unwrap_or_else(|| "#0d1117".into()),
      "canvasTransparent": payload.canvas_transparent,
      "layoutState": layout_state
    });
    let config_json = serde_json::to_string(&config)?;
    let escaped_config = escape_embedded_script_json(&config_json);
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
        .to_string();
    let escaped_vm_hierarchy = escape_embedded_script_json(&vm_hierarchy_json);
    let title = format!("{} – Rive Demo", payload.file_name);

    let template = include_str!("demo-template.html");

    let html = template
        .replace("__TITLE__", &title)
        .replace("__CANVAS_COLOR__", canvas_color)
        .replace("__CONFIG_JSON__", &escaped_config)
        .replace("__RUNTIME_SCRIPT__", &escaped_runtime)
        .replace("__VM_HIERARCHY_JSON__", &escaped_vm_hierarchy)
        .replace("__FILE_NAME__", &payload.file_name)
        .replace("__RUNTIME_DISPLAY__", runtime_display)
        .replace("__APP_ICON_DATA_URL__", &app_icon_data_url)
        .replace("__RUNTIME_VERSION__", runtime_version);

    Ok(html)
}

fn escape_embedded_script_json(raw: &str) -> String {
    raw.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace("</script", "<\\/script")
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
            if looks_like_riv_file(&trimmed)
                || (lower.starts_with("file://") && lower.contains(".riv"))
            {
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
        .on_menu_event(|_app, event| {
            if event.id() == ONLINE_DOCS_MENU_ID {
                let _ = open_external_url(RAV_DOCS_URL.to_string());
            }
        })
        .manage(OpenedFiles(Mutex::new(VecDeque::from(opened_files))))
        .manage(McpBridgeManager::new(DEFAULT_MCP_PORT))
        .manage(PendingAppUpdate::default())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let menu = Menu::default(app.handle())?;
                let docs_item = MenuItemBuilder::with_id(ONLINE_DOCS_MENU_ID, "RAV Documentation")
                    .build(app.handle())?;
                if let Some(MenuItemKind::Submenu(help_menu)) = menu.get(HELP_SUBMENU_ID) {
                    help_menu.append(&docs_item)?;
                }
                app.set_menu(menu)?;
            }
            let bridge_manager = app.state::<McpBridgeManager>();
            let saved_port = load_saved_mcp_port(app.handle());
            if let Ok(mut port_guard) = bridge_manager.port.lock() {
                *port_guard = saved_port;
            }
            if let Err(error) = ensure_mcp_bridge_running(app.handle(), &bridge_manager) {
                eprintln!("[rav-app] failed to start MCP bridge: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            make_demo_bundle,
            make_demo_bundle_to_path,
            open_devtools,
            get_mcp_server_path,
            get_mcp_port,
            get_mcp_setup_status,
            detect_node_runtime,
            check_for_app_update,
            get_opened_file,
            install_mcp_client,
            install_app_update,
            open_external_url,
            remove_mcp_client,
            relaunch_app,
            read_riv_file,
            set_mcp_port,
            stop_mcp_bridge,
            set_window_transparency_mode,
            set_window_click_through,
            set_window_click_through_mode,
            get_window_cursor_position
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(manager) = app.try_state::<McpBridgeManager>() {
                    kill_spawned_mcp_bridge(&manager);
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
                    // Queue for startup handoff + immediately forward to frontend.
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
                    // Persist for frontend startup handoff in case event listener
                    // isn't registered yet when the app is cold-launched.
                    queue_pending_opened_file(app, &path);
                    // Forward to frontend when app is already running.
                    try_emit_open_file(app, path);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        build_demo_html, escape_embedded_script_json, extract_opened_riv_file_args_from_iter,
        looks_like_riv_file, DemoBundlePayload,
    };

    #[test]
    fn detects_riv_files_for_double_click_and_open_with_args() {
        let args = vec![
            "--flag",
            "\"/Users/test/Documents/demo.riv\"",
            "file:///Users/test/Desktop/another.riv",
            "notes.txt",
            "-psn_0_12345",
            "/Users/test/Desktop/not-rive.mov",
        ];

        let parsed = extract_opened_riv_file_args_from_iter(args.iter().copied());

        assert_eq!(
            parsed,
            vec![
                "/Users/test/Documents/demo.riv".to_string(),
                "file:///Users/test/Desktop/another.riv".to_string()
            ]
        );
    }

    #[test]
    fn only_accepts_riv_payloads_for_drag_drop_and_opened_events() {
        assert!(looks_like_riv_file("/tmp/demo.riv"));
        assert!(looks_like_riv_file("FILE:///Users/test/drop-target.riv"));
        assert!(!looks_like_riv_file("/tmp/demo.riv.backup"));
        assert!(!looks_like_riv_file("/tmp/demo.txt"));
        assert!(!looks_like_riv_file(""));
    }

    #[test]
    fn escapes_script_closing_sequences_in_embedded_demo_json() {
        let raw = r#"{"instantiationCode":"<script>demo()</script>","vm":"</script>"}"#;
        let escaped = escape_embedded_script_json(raw);

        assert!(!escaped.contains("</script"));
        assert!(escaped.contains("<\\/script"));
    }

    #[test]
    fn demo_html_escapes_instantiation_snippets_before_embedding_config() {
        let payload = DemoBundlePayload {
            animation_base64: "AQID".into(),
            animations: vec![],
            artboard_name: Some("Main".into()),
            autoplay: true,
            canvas_color: Some("#0d1117".into()),
            canvas_transparent: false,
            control_snapshot: Some(r#"[{"descriptor":{"path":"root/value","kind":"number"},"kind":"number","value":42}]"#.into()),
            default_instantiation_package_source: "cdn".into(),
            file_name: "demo.riv".into(),
            instantiation_code: "<canvas></canvas>\n<script type=\"module\">\nconsole.log('ok');\n</script>".into(),
            instantiation_snippets: Some(r#"{"cdn":"<script src=\"https://unpkg.com/demo\"></script>","local":"<script type=\"module\"></script>"}"#.into()),
            instantiation_source_mode: "internal".into(),
            layout_alignment: "center".into(),
            layout_fit: "contain".into(),
            layout_state: Some("{}".into()),
            runtime_name: "webgl2".into(),
            runtime_script: "console.log('runtime');".into(),
            runtime_version: Some("2.36.0".into()),
            state_machines: vec!["main-sm".into()],
            vm_hierarchy: Some(r#"{"label":"root","text":"</script>"}"#.into()),
        };

        let html = build_demo_html(&payload).expect("demo html");

        assert!(html.contains("<\\/script>"));
        assert!(html.contains("const CONFIG = JSON.parse('"));
        assert!(html.contains("const VM_HIERARCHY = JSON.parse('"));
        assert!(html.contains("defaultInstantiationPackageSource"));
        assert!(html.contains("instantiationSnippets"));
        assert!(html.contains("controlSnapshot"));
    }
}
