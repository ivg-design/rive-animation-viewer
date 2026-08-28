use std::fs;

use serde_json::json;

use super::{
    append_with_tail_compaction, file_basename, retained_complete_tail, sanitize_details,
    session_files, snapshot_entries, OperationalTraceEntry,
};

fn temp_root() -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!(
        "rav-operational-trace-test-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).unwrap();
    root
}

fn entry(timestamp: u128, session_id: &str, sequence: u64) -> OperationalTraceEntry {
    OperationalTraceEntry {
        timestamp,
        pid: 456,
        build: "v2.5.2-dev".into(),
        session_id: session_id.into(),
        sequence,
        event: "process.start".into(),
        details: json!({ "channel": "dev" }),
    }
}

#[test]
fn diagnostic_paths_are_reduced_to_file_basenames() {
    assert_eq!(file_basename("/Users/test/Desktop/demo.riv"), "demo.riv");
    assert_eq!(
        file_basename("file:///Users/test/Desktop/demo.riv?x=1"),
        "demo.riv"
    );
    assert_eq!(file_basename("C:\\Users\\test\\demo.riv"), "demo.riv");
    let details = sanitize_details(json!({
        "file": "/Users/test/Desktop/demo.riv",
        "nested": ["/private/tmp/render-surface.html", "safe"],
    }));
    assert_eq!(details["file"], "demo.riv");
    assert_eq!(details["nested"][0], "render-surface.html");
    assert_eq!(details["nested"][1], "safe");
}

#[test]
fn one_session_file_compacts_to_its_recent_complete_tail() {
    let root = temp_root();
    let path = root.join("session-current.jsonl");
    let first = b"first-entry\n";
    let second = b"second-entry\n";
    append_with_tail_compaction(&path, first, 16).unwrap();
    append_with_tail_compaction(&path, second, 16).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "second-entry\n");

    let tail = retained_complete_tail(b"old\nrecent\npartial", 16);
    assert_eq!(tail, b"old\nrecent\n");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn snapshot_merges_sorts_and_tolerates_a_malformed_tail() {
    let root = temp_root();
    let first = root.join("session-001-1-a.jsonl");
    let second = root.join("session-002-2-b.jsonl");
    fs::write(
        &first,
        format!(
            "{}\n{{broken tail",
            serde_json::to_string(&entry(20, "a", 1)).unwrap()
        ),
    )
    .unwrap();
    fs::write(
        &second,
        format!("{}\n", serde_json::to_string(&entry(10, "b", 1)).unwrap()),
    )
    .unwrap();
    let entries = snapshot_entries(&root);
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.timestamp)
            .collect::<Vec<_>>(),
        vec![10, 20]
    );
    assert_eq!(session_files(&root).len(), 2);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn entry_schema_contains_only_operational_fields() {
    let value = serde_json::to_value(entry(123, "session", 7)).unwrap();
    assert_eq!(value["timestamp"], 123);
    assert_eq!(value["pid"], 456);
    assert_eq!(value["sequence"], 7);
    assert_eq!(value["event"], "process.start");
    assert!(value.get("path").is_none());
}
