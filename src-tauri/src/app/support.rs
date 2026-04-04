use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager};

use crate::app::state::OpenedFiles;

pub fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

#[cfg(target_os = "windows")]
pub fn appdata_dir() -> Option<PathBuf> {
    env::var_os("APPDATA").map(PathBuf::from)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[cfg(not(target_os = "windows"))]
pub fn appdata_dir() -> Option<PathBuf> {
    None
}

pub fn ensure_parent_directory(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {}", parent.display(), error))?;
    }
    Ok(())
}

pub fn looks_like_riv_file(value: &str) -> bool {
    value.trim().to_ascii_lowercase().ends_with(".riv")
}

pub fn extract_opened_riv_file_args_from_iter<I, S>(args: I) -> Vec<String>
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

pub fn extract_opened_riv_file_args() -> Vec<String> {
    extract_opened_riv_file_args_from_iter(std::env::args().skip(1))
}

pub fn try_emit_open_file(app: &AppHandle, path: String) {
    let _ = app.emit("open-file", path);
}

pub fn queue_pending_opened_file(app: &AppHandle, path: &str) {
    if let Some(state) = app.try_state::<OpenedFiles>() {
        if let Ok(mut guard) = state.0.lock() {
            if !guard.iter().any(|entry| entry == path) {
                guard.push_back(path.to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{extract_opened_riv_file_args_from_iter, looks_like_riv_file};

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
}
