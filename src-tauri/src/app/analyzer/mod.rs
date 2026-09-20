//! Sidecar-backed Rive file analysis. `analyzer_run` shells out to the `rfa`
//! sidecar binary (a sibling of the running executable, same contract as
//! `rav-mcp` — see ARCHITECTURE.md) to render an analysis report of a
//! previously captured full inspection. The host command that reaches this
//! (`rav_analyze_full`) is gated behind the same entitlement scope as
//! `rav_inspect_full`.

mod run;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

const ALLOWED_FORMATS: &[&str] = &["pdf", "html", "md"];
const DEFAULT_STEM: &str = "rive-file";
const MAX_STEM_LEN: usize = 120;
const MAX_TITLE_LEN: usize = 200;

#[derive(Debug, Deserialize)]
pub struct AnalyzerRunRequest {
    pub inspection: serde_json::Value,
    pub formats: Vec<String>,
    pub output_dir: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub stem: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AnalyzerOutput {
    pub format: String,
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct AnalyzerIssueCounts {
    pub error: Option<u64>,
    pub warning: Option<u64>,
    pub review: Option<u64>,
    pub info: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct AnalyzerSummary {
    pub rules_ran: Option<u64>,
    pub rules_skipped: Option<u64>,
    pub issues: AnalyzerIssueCounts,
    pub health: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AnalyzerRunReport {
    pub outputs: Vec<AnalyzerOutput>,
    pub summary: AnalyzerSummary,
    pub summary_line: String,
    pub duration_ms: u128,
}

/// Non-empty subset of `{pdf, html, md}`, case-insensitive, de-duplicated
/// while preserving first-seen order.
pub(crate) fn validate_formats(formats: &[String]) -> Result<Vec<String>, String> {
    if formats.is_empty() {
        return Err("formats must include at least one of: pdf, html, md".into());
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for requested in formats {
        let lower = requested.to_ascii_lowercase();
        if !ALLOWED_FORMATS.contains(&lower.as_str()) {
            return Err(format!(
                "Unsupported format \"{requested}\"; expected pdf, html, or md"
            ));
        }
        if seen.insert(lower.clone()) {
            normalized.push(lower);
        }
    }
    Ok(normalized)
}

pub(crate) fn validate_title(title: Option<&str>) -> Result<Option<String>, String> {
    let Some(title) = title else {
        return Ok(None);
    };
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > MAX_TITLE_LEN {
        return Err(format!("title must be {MAX_TITLE_LEN} characters or fewer"));
    }
    Ok(Some(trimmed.to_string()))
}

pub(crate) fn validate_output_dir(output_dir: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(output_dir);
    if path.is_dir() {
        return Ok(path);
    }
    if path.exists() {
        return Err(format!("output_dir is not a directory: {output_dir}"));
    }
    // A report destination that does not exist yet is created, so an agent can
    // name a fresh folder per run instead of pre-creating it.
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("output_dir could not be created: {output_dir}: {error}"))?;
    Ok(path)
}

/// Sanitizes a caller-supplied stem into `[A-Za-z0-9._-]{1,120}` by dropping
/// disallowed characters (collapsed to a single `-`) rather than rejecting
/// odd input outright — the stem only names a temp file and, via the
/// analyzer's own convention, its output reports.
pub(crate) fn sanitize_stem(input: Option<&str>) -> String {
    let raw = input.unwrap_or("").trim();
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            out.push(ch);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    while out.ends_with('-') || out.ends_with('.') {
        out.pop();
    }
    let truncated: String = out.chars().take(MAX_STEM_LEN).collect();
    if truncated.is_empty() {
        DEFAULT_STEM.to_string()
    } else {
        truncated
    }
}

/// Locates the `rfa` sidecar as a sibling of the running executable — the
/// same sibling-binary contract `rav-mcp` uses (see ARCHITECTURE.md). Do not
/// resolve this through a generic application-resource directory.
pub(crate) fn locate_analyzer_binary() -> Result<PathBuf, String> {
    let binary_name = if cfg!(target_os = "windows") {
        "rfa.exe"
    } else {
        "rfa"
    };
    let executable_path = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve current application executable: {error}"))?;
    let sidecar_path = executable_path
        .parent()
        .map(|directory| directory.join(binary_name))
        .ok_or_else(|| "Application executable has no parent directory".to_string())?;
    if !sidecar_path.is_file() {
        return Err("The analyzer is not included in this build".to_string());
    }
    Ok(sidecar_path)
}

#[tauri::command]
pub fn analyzer_run(
    _app: tauri::AppHandle,
    request: AnalyzerRunRequest,
) -> Result<AnalyzerRunReport, String> {
    let formats = validate_formats(&request.formats)?;
    let output_dir = validate_output_dir(&request.output_dir)?;
    let title = validate_title(request.title.as_deref())?;
    let stem = sanitize_stem(request.stem.as_deref());
    let sidecar = locate_analyzer_binary()?;
    run::execute(
        &sidecar,
        &request.inspection,
        &formats,
        &output_dir,
        title.as_deref(),
        &stem,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_formats_rejects_empty_and_unknown() {
        assert!(validate_formats(&[]).unwrap_err().contains("at least one"));
        assert!(validate_formats(&["docx".to_string()])
            .unwrap_err()
            .contains("Unsupported"));
    }

    #[test]
    fn validate_formats_normalizes_case_and_dedupes() {
        let formats =
            validate_formats(&["HTML".to_string(), "html".to_string(), "pdf".to_string()]).unwrap();
        assert_eq!(formats, vec!["html".to_string(), "pdf".to_string()]);
    }

    #[test]
    fn validate_title_enforces_length_and_trims() {
        assert_eq!(validate_title(None).unwrap(), None);
        assert_eq!(validate_title(Some("  ")).unwrap(), None);
        assert_eq!(
            validate_title(Some(" My Report ")).unwrap(),
            Some("My Report".to_string())
        );
        let long = "a".repeat(201);
        assert!(validate_title(Some(&long)).unwrap_err().contains("200"));
    }

    #[test]
    fn validate_output_dir_accepts_existing_and_creates_missing_directories() {
        let dir = std::env::temp_dir();
        assert_eq!(validate_output_dir(dir.to_str().unwrap()).unwrap(), dir);
        // A destination that does not exist yet is created for the run.
        let fresh = dir.join(format!("rav-analyzer-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&fresh);
        assert_eq!(validate_output_dir(fresh.to_str().unwrap()).unwrap(), fresh);
        assert!(fresh.is_dir());
        let _ = std::fs::remove_dir_all(&fresh);
        // A path that exists but is not a directory is rejected.
        let file = dir.join(format!("rav-analyzer-test-file-{}", std::process::id()));
        std::fs::write(&file, b"x").unwrap();
        assert!(validate_output_dir(file.to_str().unwrap())
            .unwrap_err()
            .contains("not a directory"));
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn sanitize_stem_defaults_and_collapses_illegal_characters() {
        assert_eq!(sanitize_stem(None), "rive-file");
        assert_eq!(sanitize_stem(Some("   ")), "rive-file");
        assert_eq!(sanitize_stem(Some("My File v2.riv")), "My-File-v2.riv");
    }

    #[test]
    fn sanitize_stem_never_reproduces_a_path_separator() {
        let result = sanitize_stem(Some("../../etc/passwd"));
        assert!(!result.contains('/'));
        assert!(!result.contains('\\'));
        assert!(!result.is_empty());
    }

    #[test]
    fn sanitize_stem_truncates_to_120_characters() {
        let long = "a".repeat(200);
        assert_eq!(sanitize_stem(Some(&long)).len(), MAX_STEM_LEN);
    }

    #[test]
    fn locate_analyzer_binary_reports_a_clear_error_when_absent() {
        // The cargo test binary has no sibling `rfa` executable, so this
        // always takes the "not included in this build" branch.
        let error = locate_analyzer_binary().unwrap_err();
        assert!(error.contains("not included"));
    }
}
