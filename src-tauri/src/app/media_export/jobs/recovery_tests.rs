use super::super::super::discovery;
use super::*;

pub(super) fn capture(codec: Option<&str>) -> (std::path::PathBuf, Arc<Backend>, Job) {
    let dir = std::env::temp_dir().join(format!("rav-abort-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&dir).unwrap();
    let backend = Backend::new(discovery::Discovery { binaries: None,
        capabilities: json!({"formats":[{"id":"h264","available":true},{"id":"webm","available":true}]}) }).unwrap();
    let request: BeginRequest = serde_json::from_value(json!({
        "format": if codec.is_some() { "webm" } else { "h264" }, "capture_codec":codec,
        "width":64, "height":64, "fps":{"numerator":20,"denominator":1},
        "output_path":dir.join(if codec.is_some() { "capture.webm" } else { "capture.mp4" }),
        "source_session":"fixture" }))
    .unwrap();
    let job = backend.begin(request).unwrap();
    (dir, backend, job)
}
fn abort(backend: &Backend, job: &Job, error: &str) -> Job {
    backend
        .abort(AbortRequest {
            job_id: job.job_id.clone(),
            error: error.into(),
        })
        .unwrap()
}
pub(super) fn clean(dir: std::path::PathBuf, backend: &Backend, job: &Job) {
    backend.get(&job.job_id).unwrap().spool.clean().unwrap();
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn renderer_abort_retains_png_gaps_caps_error_and_is_idempotent() {
    let (dir, backend, job) = capture(None);
    let png = discovery::fixture().unwrap();
    backend.append("fixture", &job.job_id, 0, &png).unwrap();
    let accepted = backend.append("fixture", &job.job_id, 3, &png).unwrap();
    let failed = abort(&backend, &job, &"界".repeat(2000));
    assert_eq!(failed.state, "failed");
    assert_eq!(failed.stage, "failed");
    assert_eq!(failed.received_frames, 2);
    assert_eq!(failed.bytes_spooled, accepted.bytes_spooled);
    assert_eq!(failed.error.as_ref().unwrap().len(), 4095);
    assert_eq!(failed.resolved_settings["accepted_frame_count"], 4);
    let entry = backend.get(&job.job_id).unwrap();
    assert_eq!(fs::read(entry.spool.frame_path(0)).unwrap(), png);
    assert_eq!(fs::read(entry.spool.frame_path(3)).unwrap(), png);
    assert!(!entry.spool.output.exists());
    let snapshot = serde_json::to_value(&failed).unwrap();
    assert_eq!(
        serde_json::to_value(abort(&backend, &job, "later error")).unwrap(),
        snapshot
    );
    assert_eq!(
        serde_json::to_value(backend.cancel(&job.job_id).unwrap()).unwrap(),
        snapshot
    );
    assert!(backend.append("fixture", &job.job_id, 4, &png).is_err());
    assert!(entry.spool.dir.join("recovery.json").is_file());
    clean(dir, &backend, &job);
}
#[test]
fn renderer_abort_retains_encoded_prefix_and_repairs_ivf_header() {
    let (dir, backend, job) = capture(Some("vp9"));
    let accepted = backend
        .append(
            "fixture",
            &job.job_id,
            0,
            &[2, 0, 0, 0, 1, 0, 0, 0, 0x82, 1, 0, 0, 0, 0x82],
        )
        .unwrap();
    let entry = backend.get(&job.job_id).unwrap();
    let source = entry.spool.dir.join("capture.ivf");
    fs::OpenOptions::new()
        .append(true)
        .open(&source)
        .unwrap()
        .write_all(b"unacknowledged tail")
        .unwrap();
    let failed = abort(&backend, &job, "Renderer transport failure");
    let bytes = fs::read(&source).unwrap();
    assert_eq!(bytes.len() as u64, accepted.bytes_spooled);
    assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 2);
    assert_eq!(failed.received_frames, 2);
    assert_eq!(failed.resolved_settings["accepted_frame_count"], 2);
    assert!(!entry.spool.output.exists());
    clean(dir, &backend, &job);
}
#[test]
fn shortened_encoded_source_and_png_journal_are_never_zero_extended() {
    for codec in [None, Some("vp9")] {
        let (dir, backend, job) = capture(codec);
        let body = if codec.is_some() {
            vec![1, 0, 0, 0, 1, 0, 0, 0, 0x82]
        } else {
            discovery::fixture().unwrap()
        };
        backend.append("fixture", &job.job_id, 0, &body).unwrap();
        let entry = backend.get(&job.job_id).unwrap();
        let source = entry.spool.dir.join(if codec.is_some() {
            "capture.ivf"
        } else {
            "frames.idx"
        });
        let shorter = fs::metadata(&source).unwrap().len() - 1;
        fs::OpenOptions::new()
            .write(true)
            .open(&source)
            .unwrap()
            .set_len(shorter)
            .unwrap();
        let failed = abort(&backend, &job, "I/O failure");
        assert_eq!(fs::metadata(&source).unwrap().len(), shorter);
        assert!(failed
            .warnings
            .iter()
            .any(|w| w.contains("shorter than acknowledged prefix")));
        let descriptor: Value =
            serde_json::from_slice(&fs::read(entry.spool.dir.join("recovery.json")).unwrap())
                .unwrap();
        assert_eq!(descriptor["accepted_prefix_repaired"], false);
        assert_eq!(descriptor["received_frames"], 1);
        clean(dir, &backend, &job);
    }
}
#[test]
fn abort_is_noop_after_capture_and_zero_frame_abort_has_nothing_to_retain() {
    for state in ["encoding", "completed", "failed", "cancelled"] {
        let (dir, backend, job) = capture(None);
        let entry = backend.get(&job.job_id).unwrap();
        let expected = {
            let mut inner = entry.inner.lock().unwrap();
            inner.job.state = state.into();
            inner.job.stage = state.into();
            inner.job.error = Some("original receipt".into());
            serde_json::to_value(&inner.job).unwrap()
        };
        assert_eq!(
            serde_json::to_value(abort(&backend, &job, "must not replace")).unwrap(),
            expected
        );
        assert!(entry.spool.dir.exists());
        assert!(!entry.spool.dir.join("recovery.json").exists());
        clean(dir, &backend, &job);
    }
    let (dir, backend, job) = capture(None);
    let failed = abort(&backend, &job, "");
    assert_eq!(failed.state, "failed");
    assert_eq!(failed.error.as_deref(), Some("Capture aborted by renderer"));
    assert!(!backend.get(&job.job_id).unwrap().spool.dir.exists());
    clean(dir, &backend, &job);
}
#[test]
fn explicit_cancel_still_cleans_an_active_accepted_capture() {
    let (dir, backend, job) = capture(Some("vp9"));
    backend
        .append("fixture", &job.job_id, 0, &[1, 0, 0, 0, 1, 0, 0, 0, 0x82])
        .unwrap();
    let cancelled = backend.cancel(&job.job_id).unwrap();
    assert_eq!(cancelled.state, "cancelled");
    assert!(!backend.get(&job.job_id).unwrap().spool.dir.exists());
    assert_eq!(
        serde_json::to_value(abort(&backend, &job, "late error")).unwrap(),
        serde_json::to_value(cancelled).unwrap()
    );
    clean(dir, &backend, &job);
}

#[test]
fn idle_expiry_retains_png_gaps_and_encoded_prefix_without_waiting() {
    for codec in [None, Some("vp9")] {
        let (dir, backend, job) = capture(codec);
        let png = discovery::fixture().unwrap();
        let accepted = if codec.is_some() {
            backend
                .append(
                    "fixture",
                    &job.job_id,
                    0,
                    &[2, 0, 0, 0, 1, 0, 0, 0, 0x82, 1, 0, 0, 0, 0x82],
                )
                .unwrap()
        } else {
            backend.append("fixture", &job.job_id, 0, &png).unwrap();
            backend.append("fixture", &job.job_id, 3, &png).unwrap()
        };
        let entry = backend.get(&job.job_id).unwrap();
        // Inject only capture inactivity; exercise the production expiry path immediately.
        entry.inner.lock().unwrap().touched = Instant::now() - Duration::from_secs(121);
        backend.expire();
        let failed = backend.status(&job.job_id).unwrap();
        assert_eq!(failed.state, "failed");
        assert_eq!(failed.stage, "failed");
        assert!(failed.error.as_ref().unwrap().contains("idle watchdog"));
        assert_eq!(failed.received_frames, 2);
        assert_eq!(failed.bytes_spooled, accepted.bytes_spooled);
        assert_eq!(
            failed.resolved_settings["accepted_frame_count"],
            if codec.is_some() { 2 } else { 4 }
        );
        assert!(!entry.spool.output.exists());
        let descriptor: Value =
            serde_json::from_slice(&fs::read(entry.spool.dir.join("recovery.json")).unwrap())
                .unwrap();
        assert_eq!(descriptor["accepted_prefix_repaired"], true);
        if codec.is_some() {
            let bytes = fs::read(entry.spool.dir.join("capture.ivf")).unwrap();
            assert_eq!(bytes.len() as u64, accepted.bytes_spooled);
            assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 2);
        } else {
            assert_eq!(fs::read(entry.spool.frame_path(0)).unwrap(), png);
            assert_eq!(fs::read(entry.spool.frame_path(3)).unwrap(), png);
            assert_eq!(
                fs::read(entry.spool.dir.join("frames.idx")).unwrap(),
                [0u32.to_le_bytes(), 3u32.to_le_bytes()].concat()
            );
        }
        let receipt = serde_json::to_value(&failed).unwrap();
        backend.expire();
        assert_eq!(
            serde_json::to_value(backend.status(&job.job_id).unwrap()).unwrap(),
            receipt
        );
        // Recovery protection survives the original process owner being gone.
        let journal = std::env::temp_dir()
            .join("rav-media-export-v1")
            .join(&job.job_id);
        let mut marker: Value = serde_json::from_slice(&fs::read(&journal).unwrap()).unwrap();
        assert_eq!(marker["retain_for_recovery"], true);
        marker["pid"] = json!(0);
        fs::write(&journal, marker.to_string()).unwrap();
        spool::reap_abandoned().unwrap();
        assert!(entry.spool.dir.exists());
        clean(dir, &backend, &job);
    }
}
#[test]
fn expiry_respects_recent_activity_non_capture_state_and_explicit_cancellation() {
    let (dir, backend, job) = capture(None);
    let png = discovery::fixture().unwrap();
    let entry = backend.get(&job.job_id).unwrap();
    entry.inner.lock().unwrap().touched = Instant::now() - Duration::from_secs(121);
    // An accepted write resets the injected idle clock.
    backend.append("fixture", &job.job_id, 0, &png).unwrap();
    backend.expire();
    assert_eq!(backend.status(&job.job_id).unwrap().state, "capturing");
    {
        let mut inner = entry.inner.lock().unwrap();
        inner.job.state = "encoding".into();
        inner.job.stage = "verifying".into();
        inner.touched = Instant::now() - Duration::from_secs(121);
    }
    let expected = serde_json::to_value(backend.status(&job.job_id).unwrap()).unwrap();
    backend.expire();
    assert_eq!(
        serde_json::to_value(backend.status(&job.job_id).unwrap()).unwrap(),
        expected
    );
    assert!(!entry.spool.dir.join("recovery.json").exists());
    entry.inner.lock().unwrap().job.state = "capturing".into();
    entry.control.cancel.store(true, Ordering::SeqCst);
    backend.expire();
    assert_eq!(backend.status(&job.job_id).unwrap().state, "cancelled");
    assert!(!entry.spool.dir.exists());
    clean(dir, &backend, &job);
    let (dir, backend, job) = capture(None);
    let entry = backend.get(&job.job_id).unwrap();
    entry.inner.lock().unwrap().touched = Instant::now() - Duration::from_secs(121);
    backend.expire();
    assert_eq!(backend.status(&job.job_id).unwrap().state, "failed");
    assert!(!entry.spool.dir.exists());
    clean(dir, &backend, &job);
}
#[test]
fn status_contention_does_not_reject_binary_or_legacy_frame_uploads() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    for (codec, legacy) in [(None, false), (None, true), (Some("vp9"), false)] {
        let (dir, backend, job) = capture(codec);
        let id = job.job_id.clone();
        let body = if codec.is_some() {
            vec![1, 0, 0, 0, 1, 0, 0, 0, 0x82]
        } else {
            discovery::fixture().unwrap()
        };
        let entry = backend.get(&id).unwrap();
        let status_guard = entry.inner.lock().unwrap();
        let (started, start) = std::sync::mpsc::channel();
        let (finished, result) = std::sync::mpsc::channel();
        let writer = backend.clone();
        let upload = thread::spawn(move || {
            started.send(()).unwrap();
            let outcome = if legacy {
                writer
                    .frame(FrameRequest {
                        job_id: id,
                        frame_index: 0,
                        png_base64: STANDARD.encode(body),
                    })
                    .map(|job| job.received_frames)
            } else {
                writer
                    .append("fixture", &id, 0, &body)
                    .map(|receipt| receipt.received_frames)
            };
            finished.send(outcome).unwrap();
        });
        start.recv().unwrap();
        assert!(matches!(
            result.recv_timeout(Duration::from_millis(50)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));
        drop(status_guard);
        assert_eq!(
            result
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap(),
            1
        );
        upload.join().unwrap();
        backend.cancel(&job.job_id).unwrap();
        clean(dir, &backend, &job);
    }
}
