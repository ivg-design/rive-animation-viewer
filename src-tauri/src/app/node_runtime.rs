use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::app::state::NodeRuntimeStatus;
use crate::app::support::home_dir;

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
                    .map(|character| character.is_ascii_digit())
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
pub fn detect_node_runtime() -> NodeRuntimeStatus {
    for candidate in candidate_node_paths() {
        if let Some(status) = try_node_at_path(&candidate, "path-search") {
            return status;
        }
    }

    if let Some(status) = detect_node_via_shell() {
        return status;
    }

    let _ = home_dir();

    NodeRuntimeStatus {
        installed: false,
        path: None,
        version: None,
        source: None,
    }
}
