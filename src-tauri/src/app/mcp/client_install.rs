use std::fs;
use std::path::Path;

use toml_edit::{value, DocumentMut};

use crate::app::mcp::bridge::{build_mcp_args, build_mcp_args_array};
use crate::app::mcp::client_config::{
    claude_code_config_path,
    claude_desktop_config_path,
    codex_config_path,
    remove_claude_code_entries,
};
use crate::app::state::McpInstallResult;
use crate::app::support::ensure_parent_directory;

pub fn install_codex_mcp_with_port(server_path: &Path, port: u16) -> Result<McpInstallResult, String> {
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

pub fn install_claude_desktop_mcp_with_port(server_path: &Path, port: u16) -> Result<McpInstallResult, String> {
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

pub fn install_claude_code_mcp_with_port(server_path: &Path, port: u16) -> Result<McpInstallResult, String> {
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

pub fn remove_codex_mcp() -> Result<McpInstallResult, String> {
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

pub fn remove_claude_desktop_mcp() -> Result<McpInstallResult, String> {
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

pub fn remove_claude_code_mcp() -> Result<McpInstallResult, String> {
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
