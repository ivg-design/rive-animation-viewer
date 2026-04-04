use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use toml_edit::{DocumentMut, Item};

use crate::app::mcp::bridge::build_mcp_args;
use crate::app::state::McpClientStatus;
use crate::app::support::home_dir;

#[derive(Clone)]
pub struct JsonMcpServerEntry {
    pub scope_label: String,
    pub command: Option<String>,
    pub args: Vec<String>,
}

pub fn codex_config_path() -> Option<PathBuf> {
    home_dir().map(|path| path.join(".codex").join("config.toml"))
}

pub fn claude_desktop_config_path() -> Option<PathBuf> {
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
        return crate::app::support::appdata_dir()
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

pub fn claude_code_config_path() -> Option<PathBuf> {
    home_dir().map(|path| path.join(".claude.json"))
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
            candidates.push(local_app_data.join("Programs").join(command).join(&binary_name));
        }
    }

    let mut seen = HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.clone()));
    candidates
}

pub fn find_command_path(command: &str) -> Option<PathBuf> {
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

pub fn remove_claude_code_entries(root: &mut serde_json::Value) {
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

pub fn build_mcp_targets(server_paths: &[PathBuf], port: u16) -> Vec<McpClientStatus> {
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
