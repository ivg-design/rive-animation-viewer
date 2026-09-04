pub mod media;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager, Url};

use crate::app::operational_trace::{file_basename, record};
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

/// Converts file URLs and filesystem aliases to the same canonical queue key.
/// A missing path remains a normalized display path so a later read can still
/// provide the expected native error, while existing paths collapse symlinks
/// and `..` aliases before deduplication.
pub fn normalize_opened_riv_file_path(value: &str) -> Option<String> {
    let trimmed = value.trim_matches('"').trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = if trimmed.to_ascii_lowercase().starts_with("file://") {
        Url::parse(trimmed).ok()?.to_file_path().ok()?
    } else {
        PathBuf::from(trimmed)
    };
    let normalized = fs::canonicalize(&path).unwrap_or(path);
    Some(normalized.to_string_lossy().to_string())
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
                normalize_opened_riv_file_path(&trimmed)
            } else {
                None
            }
        })
        .fold(Vec::new(), |mut files, path| {
            if !files.contains(&path) {
                files.push(path);
            }
            files
        })
}

pub fn extract_opened_riv_file_args() -> Vec<String> {
    extract_opened_riv_file_args_from_iter(std::env::args().skip(1))
}

pub fn try_emit_open_file(app: &AppHandle, path: String) {
    let Some(path) = normalize_opened_riv_file_path(&path) else {
        record(
            app,
            "opened_file.emit_rejected",
            serde_json::json!({ "reason": "invalid_path" }),
        );
        return;
    };
    let name = file_basename(&path);
    let emitted = app.emit("open-file", path).is_ok();
    record(
        app,
        "opened_file.emit",
        serde_json::json!({ "fileName": name, "emitted": emitted }),
    );
}

pub fn queue_pending_opened_file(app: &AppHandle, path: &str) {
    let Some(path) = normalize_opened_riv_file_path(path) else {
        record(
            app,
            "opened_file.queue_rejected",
            serde_json::json!({ "reason": "invalid_path" }),
        );
        return;
    };
    if let Some(state) = app.try_state::<OpenedFiles>() {
        if let Ok(mut guard) = state.0.lock() {
            if !guard.iter().any(|entry| entry == &path) {
                guard.push_back(path.clone());
                record(
                    app,
                    "opened_file.queue",
                    serde_json::json!({ "fileName": file_basename(&path), "queued": true }),
                );
            } else {
                record(
                    app,
                    "opened_file.queue_duplicate",
                    serde_json::json!({ "fileName": file_basename(&path) }),
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        extract_opened_riv_file_args_from_iter, looks_like_riv_file, normalize_opened_riv_file_path,
    };

    #[test]
    fn detects_riv_files_for_double_click_and_open_with_args() {
        let args = [
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
                "/Users/test/Desktop/another.riv".to_string()
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
    fn normalizes_file_urls_and_existing_filesystem_aliases_for_queue_deduplication() {
        let root = std::env::temp_dir().join(format!("rav-open-path-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("fixture.riv");
        std::fs::write(&file, b"RIVE").unwrap();
        let file_url = tauri::Url::from_file_path(&file).unwrap().to_string();
        let alias = root.join(".").join("fixture.riv");

        let canonical = normalize_opened_riv_file_path(file.to_string_lossy().as_ref()).unwrap();
        assert_eq!(
            normalize_opened_riv_file_path(&file_url).unwrap(),
            canonical
        );
        assert_eq!(
            normalize_opened_riv_file_path(alias.to_string_lossy().as_ref()).unwrap(),
            canonical
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
