//! Bounded, local diagnostics for the RAV application shell itself.
//!
//! This is intentionally separate from `.riv` inspection and runtime
//! diagnostics. It records only application lifecycle facts (startup, native
//! document-open delivery, and bridge setup) and never stores animation data,
//! ViewModel values, or full file paths. DEV bundles enable it automatically;
//! official releases and documentation-capture builds leave the state inert.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::app::constants::is_official_app_identifier;

const TRACE_DIRECTORY_NAME: &str = "rav-operations";
const SESSION_FILE_PREFIX: &str = "session-";
const SESSION_FILE_SUFFIX: &str = ".jsonl";
const MAX_TRACE_BYTES: u64 = 256 * 1024;
const MAX_ENTRY_BYTES: usize = 4 * 1024;
const MAX_RETAINED_SESSIONS: usize = 12;
const MAX_TRACE_ENTRIES: usize = 1_000;
const MAX_DETAIL_TEXT_BYTES: usize = 256;

#[derive(Default)]
pub struct OperationalTrace {
    state: Mutex<TraceState>,
}

#[derive(Default)]
struct TraceState {
    enabled: bool,
    directory: Option<PathBuf>,
    path: Option<PathBuf>,
    build: String,
    session_id: String,
    sequence: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationalTraceEntry {
    /// Unix epoch milliseconds keep this dependency-free and sortable across
    /// native/WebView process boundaries.
    pub timestamp: u128,
    pub pid: u32,
    pub build: String,
    pub session_id: String,
    pub sequence: u64,
    pub event: String,
    pub details: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationalTraceSnapshot {
    pub enabled: bool,
    pub entries: Vec<OperationalTraceEntry>,
}

/// Starts the trace before RAV builds its main WebView. Failures deliberately
/// do not block startup: diagnostics must never become a new failure mode.
pub fn initialize(app: &AppHandle, trace: &OperationalTrace) {
    let enabled = tracing_enabled_for_identifier(&app.config().identifier);
    let mut state = match trace.state.lock() {
        Ok(state) => state,
        Err(_) => return,
    };
    state.enabled = enabled;
    state.build = format!(
        "v{}{}",
        app.package_info().version,
        if enabled { "-dev" } else { "" }
    );
    if !enabled {
        return;
    }

    let Ok(data_directory) = app.path().app_data_dir() else {
        return;
    };
    let directory = data_directory.join(TRACE_DIRECTORY_NAME);
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    state.directory = Some(directory.clone());
    state.session_id = session_id.clone();
    state.sequence = 0;
    state.path = Some(directory.join(format!(
        "{SESSION_FILE_PREFIX}{}-{}-{session_id}{SESSION_FILE_SUFFIX}",
        now_millis(),
        std::process::id(),
    )));
    append_entry_locked(
        &mut state,
        "process.start",
        json!({
            "channel": "dev",
            "appIdentifier": app.config().identifier,
        }),
    );
    let _ = retain_recent_sessions(&directory, MAX_RETAINED_SESSIONS);
}

fn tracing_enabled_for_identifier(identifier: &str) -> bool {
    !cfg!(feature = "docs-capture") && !is_official_app_identifier(identifier)
}

/// Records a RAV shell event through an app handle when tracing is enabled.
/// Callers must pass operational metadata only; this module also constrains
/// strings and reduces any accidental path-like value to its basename.
pub fn record(app: &AppHandle, event: &str, details: Value) {
    let Some(trace) = app.try_state::<OperationalTrace>() else {
        return;
    };
    let entry = record_state(&trace, event, details);
    // Let a future DEV diagnostics surface refresh without polling. The entry
    // has already been persisted, and emitting cannot hold the trace mutex.
    if let Some(entry) = entry {
        let _ = app.emit("rav-operational-trace-entry", entry);
    }
}

/// Records from a Tauri command that already owns application state. This
/// persists only; callers without an AppHandle cannot emit a live UI event.
pub fn record_state(
    trace: &OperationalTrace,
    event: &str,
    details: Value,
) -> Option<OperationalTraceEntry> {
    let Ok(mut state) = trace.state.lock() else {
        return None;
    };
    append_entry_locked(&mut state, event, details)
}

pub fn file_basename(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let without_query = trimmed.split(['?', '#']).next().unwrap_or(trimmed);
    without_query
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_string()
}

fn append_entry_locked(
    state: &mut TraceState,
    event: &str,
    details: Value,
) -> Option<OperationalTraceEntry> {
    if !state.enabled {
        return None;
    }
    let path = state.path.clone()?;
    state.sequence = state.sequence.saturating_add(1);
    let mut entry = OperationalTraceEntry {
        timestamp: now_millis(),
        pid: std::process::id(),
        build: state.build.clone(),
        session_id: state.session_id.clone(),
        sequence: state.sequence,
        event: truncate_text(event),
        details: sanitize_details(details),
    };
    let mut line = serialize_line(&entry)?;
    if line.len() > MAX_ENTRY_BYTES {
        entry.details = json!({ "truncated": true });
        line = serialize_line(&entry)?;
    }
    append_with_tail_compaction(&path, &line, MAX_TRACE_BYTES).ok()?;
    Some(entry)
}

fn serialize_line(entry: &OperationalTraceEntry) -> Option<Vec<u8>> {
    let mut line = serde_json::to_vec(entry).ok()?;
    line.push(b'\n');
    Some(line)
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn truncate_text(value: &str) -> String {
    let mut result = String::new();
    for character in value.chars() {
        if result.len() + character.len_utf8() > MAX_DETAIL_TEXT_BYTES {
            result.push('…');
            break;
        }
        result.push(character);
    }
    result
}

fn sanitize_details(value: Value) -> Value {
    match value {
        Value::String(text) => Value::String(sanitize_text(&text)),
        Value::Array(entries) => Value::Array(entries.into_iter().map(sanitize_details).collect()),
        Value::Object(entries) => Value::Object(
            entries
                .into_iter()
                .map(|(key, value)| (truncate_text(&key), sanitize_details(value)))
                .collect(),
        ),
        primitive => primitive,
    }
}

fn sanitize_text(value: &str) -> String {
    let reduced = if value.contains('/') || value.contains('\\') {
        file_basename(value)
    } else {
        value.to_string()
    };
    truncate_text(&reduced)
}

/// Keeps a single process/session file bounded while retaining its most recent
/// complete JSONL entries. A malformed partial tail is discarded rather than
/// poisoning the next append or snapshot.
fn append_with_tail_compaction(path: &Path, line: &[u8], max_bytes: u64) -> Result<(), String> {
    let current_len = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if current_len.saturating_add(line.len() as u64) > max_bytes && current_len > 0 {
        let existing =
            fs::read(path).map_err(|error| format!("failed to read operational trace: {error}"))?;
        let retained = retained_complete_tail(
            &existing,
            max_bytes.saturating_sub(line.len() as u64) as usize,
        );
        fs::write(path, retained)
            .map_err(|error| format!("failed to compact operational trace: {error}"))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("failed to open operational trace: {error}"))?;
    file.write_all(line)
        .and_then(|_| file.flush())
        .map_err(|error| format!("failed to write operational trace: {error}"))
}

fn retained_complete_tail(contents: &[u8], max_bytes: usize) -> Vec<u8> {
    let mut retained = Vec::new();
    let mut used = 0usize;
    for line in contents.split_inclusive(|byte| *byte == b'\n').rev() {
        if !line.ends_with(b"\n") || used.saturating_add(line.len()) > max_bytes {
            continue;
        }
        retained.push(line);
        used += line.len();
    }
    retained.reverse();
    retained.concat()
}

fn session_files(directory: &Path) -> Vec<PathBuf> {
    let mut paths = fs::read_dir(directory)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with(SESSION_FILE_PREFIX) && name.ends_with(SESSION_FILE_SUFFIX)
                    })
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn retain_recent_sessions(directory: &Path, maximum: usize) -> Result<(), String> {
    let paths = session_files(directory);
    let expired_count = paths.len().saturating_sub(maximum);
    for path in paths.into_iter().take(expired_count) {
        fs::remove_file(path)
            .map_err(|error| format!("failed to trim operational traces: {error}"))?;
    }
    Ok(())
}

fn snapshot_entries(directory: &Path) -> Vec<OperationalTraceEntry> {
    let mut entries = session_files(directory)
        .into_iter()
        .rev()
        .take(MAX_RETAINED_SESSIONS)
        .flat_map(|path| {
            fs::read_to_string(path)
                .unwrap_or_default()
                .lines()
                .filter_map(|line| serde_json::from_str::<OperationalTraceEntry>(line).ok())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        left.timestamp
            .cmp(&right.timestamp)
            .then_with(|| left.pid.cmp(&right.pid))
            .then_with(|| left.session_id.cmp(&right.session_id))
            .then_with(|| left.sequence.cmp(&right.sequence))
    });
    if entries.len() > MAX_TRACE_ENTRIES {
        entries.drain(..entries.len() - MAX_TRACE_ENTRIES);
    }
    entries
}

fn snapshot(trace: &OperationalTrace) -> Result<OperationalTraceSnapshot, String> {
    let state = trace
        .state
        .lock()
        .map_err(|_| "failed to read operational trace state".to_string())?;
    if !state.enabled {
        return Ok(OperationalTraceSnapshot {
            enabled: false,
            entries: Vec::new(),
        });
    }
    let entries = state
        .directory
        .as_deref()
        .map(snapshot_entries)
        .unwrap_or_default();
    Ok(OperationalTraceSnapshot {
        enabled: true,
        entries,
    })
}

fn clear(trace: &OperationalTrace) -> Result<(), String> {
    let state = trace
        .state
        .lock()
        .map_err(|_| "failed to access operational trace state".to_string())?;
    if !state.enabled {
        return Ok(());
    }
    let Some(directory) = state.directory.as_deref() else {
        return Ok(());
    };
    for path in session_files(directory) {
        fs::remove_file(path)
            .map_err(|error| format!("failed to clear operational trace: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_rav_operational_trace(
    trace: State<'_, OperationalTrace>,
) -> Result<OperationalTraceSnapshot, String> {
    snapshot(&trace)
}

#[tauri::command]
pub fn clear_rav_operational_trace(trace: State<'_, OperationalTrace>) -> Result<(), String> {
    clear(&trace)
}

#[cfg(test)]
mod tests;
