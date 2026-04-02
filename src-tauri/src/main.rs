// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::collections::VecDeque;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::menu::Menu;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use toml_edit::{value, Array, DocumentMut};

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
    method: String,
    cli_path: Option<String>,
    config_path: Option<String>,
    detail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpSetupStatus {
    server_path: String,
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
    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?
        .join("resources")
        .join(binary_name);
    if resource_path.exists() {
        Ok(resource_path)
    } else {
        Err(format!(
            "MCP server not found at {}",
            resource_path.display()
        ))
    }
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

fn codex_has_server(path: &Path) -> bool {
    let Ok(raw) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(doc) = raw.parse::<DocumentMut>() else {
        return false;
    };
    doc.get("mcp_servers")
        .and_then(|item| item.get("rav-mcp"))
        .is_some()
}

fn claude_desktop_has_server(path: &Path) -> bool {
    let Ok(raw) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    value
        .get("mcpServers")
        .and_then(serde_json::Value::as_object)
        .map(|servers| servers.contains_key("rav-mcp"))
        .unwrap_or(false)
}

fn claude_code_has_server(command_path: &Path) -> bool {
    Command::new(command_path)
        .args(["mcp", "get", "rav-mcp"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn build_mcp_targets() -> Vec<McpClientStatus> {
    let codex_config = codex_config_path();
    let codex_cli = find_command_path("codex");
    let codex_available = codex_config.is_some() || codex_cli.is_some();
    let codex_installed = codex_config
        .as_deref()
        .map(codex_has_server)
        .unwrap_or(false);

    let claude_code_cli = find_command_path("claude");
    let claude_code_available = claude_code_cli.is_some();
    let claude_code_installed = claude_code_cli
        .as_deref()
        .map(claude_code_has_server)
        .unwrap_or(false);

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
    let claude_desktop_installed = claude_desktop_config
        .as_deref()
        .map(claude_desktop_has_server)
        .unwrap_or(false);

    vec![
        McpClientStatus {
            id: "codex".into(),
            label: "Codex".into(),
            available: codex_available,
            installed: codex_installed,
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
            method: "cli".into(),
            cli_path: claude_code_cli.map(|path| path.to_string_lossy().to_string()),
            config_path: None,
            detail: Some("Uses claude mcp add-json in user scope".into()),
        },
        McpClientStatus {
            id: "claude-desktop".into(),
            label: "Claude Desktop".into(),
            available: claude_desktop_available,
            installed: claude_desktop_installed,
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

fn install_codex_mcp(server_path: &Path) -> Result<McpInstallResult, String> {
    let config_path = codex_config_path().ok_or_else(|| "Codex config path could not be resolved".to_string())?;
    ensure_parent_directory(&config_path)?;

    let raw = fs::read_to_string(&config_path).unwrap_or_default();
    let mut doc = raw.parse::<DocumentMut>().unwrap_or_default();
    let args = Array::new();

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

fn install_claude_desktop_mcp(server_path: &Path) -> Result<McpInstallResult, String> {
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
            "args": []
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

fn install_claude_code_mcp(server_path: &Path) -> Result<McpInstallResult, String> {
    let cli_path =
        find_command_path("claude").ok_or_else(|| "Claude Code CLI was not detected".to_string())?;
    let payload = serde_json::json!({
        "type": "stdio",
        "command": server_path.to_string_lossy().to_string(),
        "args": []
    });
    let payload_string =
        serde_json::to_string(&payload).map_err(|error| format!("Failed to encode JSON: {}", error))?;

    let _ = Command::new(&cli_path)
        .args(["mcp", "remove", "-s", "user", "rav-mcp"])
        .output();

    let output = Command::new(&cli_path)
        .args(["mcp", "add-json", "-s", "user", "rav-mcp", &payload_string])
        .output()
        .map_err(|error| format!("Failed to run {}: {}", cli_path.display(), error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("Claude Code install failed: {}", detail));
    }

    Ok(McpInstallResult {
        target: "claude-code".into(),
        installed: true,
        detail: "Installed rav-mcp into Claude Code user config".into(),
    })
}

#[tauri::command]
fn get_mcp_setup_status(app: tauri::AppHandle) -> Result<McpSetupStatus, String> {
    let server_path = resolve_mcp_server_path(&app)?;
    Ok(McpSetupStatus {
        server_path: server_path.to_string_lossy().to_string(),
        targets: build_mcp_targets(),
    })
}

#[tauri::command]
fn install_mcp_client(app: tauri::AppHandle, target: String) -> Result<McpInstallResult, String> {
    let server_path = resolve_mcp_server_path(&app)?;
    match target.as_str() {
        "codex" => install_codex_mcp(&server_path),
        "claude-code" => install_claude_code_mcp(&server_path),
        "claude-desktop" => install_claude_desktop_mcp(&server_path),
        _ => Err(format!("Unsupported MCP target: {}", target)),
    }
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
async fn check_for_app_update(app: tauri::AppHandle) -> Result<AppUpdateStatus, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let current_version = app.package_info().version.to_string();
    let update = updater.check().await.map_err(|error| error.to_string())?;

    Ok(match update {
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
async fn install_app_update(app: tauri::AppHandle) -> Result<AppUpdateInstallResult, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;

    let Some(update) = update else {
        return Ok(AppUpdateInstallResult {
            installed: false,
            version: None,
        });
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    Ok(AppUpdateInstallResult {
        installed: true,
        version: Some(update.version.clone()),
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
            make_demo_bundle_to_path,
            open_devtools,
            get_mcp_server_path,
            get_mcp_setup_status,
            detect_node_runtime,
            check_for_app_update,
            get_opened_file,
            install_mcp_client,
            install_app_update,
            open_external_url,
            relaunch_app,
            read_riv_file,
            set_window_transparency_mode,
            set_window_click_through,
            set_window_click_through_mode,
            get_window_cursor_position
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
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
