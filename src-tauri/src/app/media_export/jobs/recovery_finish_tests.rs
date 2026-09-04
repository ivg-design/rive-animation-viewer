use super::super::super::discovery;
use super::tests::{capture, clean};
use super::*;

fn wait_for_failed_finish(backend: &Backend, job: &Job) -> Job {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let result = backend.status(&job.job_id).unwrap();
        if result.state != "encoding" {
            return result;
        }
        assert!(Instant::now() < deadline, "finalization did not settle");
        thread::sleep(Duration::from_millis(5));
    }
}
#[test]
fn long_gifski_finish_failure_retains_master_and_explicit_controls() {
    for (encoder, advanced) in [("gifski", false), ("gifski", true), ("auto", true)] {
        let dir = std::env::temp_dir().join(format!("rav-gif-recovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        // Deliberately nonexistent binaries: the adapter bound must fail before
        // spawning anything or materializing a long sequence of held PNG links.
        let backend = Backend::new(discovery::Discovery {
            binaries: Some(Binaries { ffmpeg:dir.join("never-run-ffmpeg"), ffprobe:dir.join("never-run-ffprobe"), gifski:Some(dir.join("never-run-gifski")) }),
            capabilities: json!({"formats":[{"id":"gif","available":true}],
                "gif":{"gifski_available":true,"ffmpeg_available":true,"resolved_auto_encoder":"gifski"}}),
        }).unwrap();
        let gif = json!({"encoder":encoder,"quality":83,
            "motion_quality":if advanced {Some(71)} else {None},
            "lossy_quality":if advanced {Some(62)} else {None}});
        let request: BeginRequest =
            serde_json::from_value(json!({"format":"gif","width":64,"height":64,
            "fps":{"numerator":20,"denominator":1},"output_path":dir.join("long.gif"),
            "source_session":"fixture","gif":gif}))
            .unwrap();
        let job = backend.begin(request).unwrap();
        let png = discovery::fixture().unwrap();
        let last = gif::gifski_frame_limit();
        backend.append("fixture", &job.job_id, 0, &png).unwrap();
        backend.append("fixture", &job.job_id, last, &png).unwrap();
        backend
            .finish(FinishRequest {
                job_id: job.job_id.clone(),
                frame_count: last + 1,
            })
            .unwrap();
        let failed = wait_for_failed_finish(&backend, &job);
        assert_eq!(failed.stage, "failed");
        assert_eq!(failed.received_frames, 2);
        assert!(failed
            .error
            .as_ref()
            .unwrap()
            .contains("platform argument bound"));
        let entry = backend.get(&job.job_id).unwrap();
        assert!(!entry.spool.output.exists());
        assert!(!entry.spool.dir.join("sequence").exists());
        assert_eq!(fs::read(entry.spool.frame_path(0)).unwrap(), png);
        assert_eq!(fs::read(entry.spool.frame_path(last)).unwrap(), png);
        let descriptor: Value =
            serde_json::from_slice(&fs::read(entry.spool.dir.join("recovery.json")).unwrap())
                .unwrap();
        assert_eq!(descriptor["frame_count"], last + 1);
        assert_eq!(descriptor["request"]["gif"]["encoder"], encoder);
        for setting in ["quality", "motion_quality", "lossy_quality"] {
            assert_eq!(descriptor["request"]["gif"][setting], gif[setting]);
        }
        assert!(failed
            .warnings
            .iter()
            .any(|w| w.contains("retained for manual recovery")));
        assert!(failed.resolved_settings["recovery_spool"].is_string());
        clean(dir, &backend, &job);
    }
}
#[test]
fn unavailable_encoder_after_finish_retains_accepted_capture() {
    let (dir, backend, job) = capture(None);
    let png = discovery::fixture().unwrap();
    backend.append("fixture", &job.job_id, 0, &png).unwrap();
    backend
        .finish(FinishRequest {
            job_id: job.job_id.clone(),
            frame_count: 1,
        })
        .unwrap();
    let failed = wait_for_failed_finish(&backend, &job);
    assert_eq!(failed.stage, "failed");
    assert_eq!(failed.error.as_deref(), Some("Encoder unavailable"));
    let entry = backend.get(&job.job_id).unwrap();
    assert_eq!(fs::read(entry.spool.frame_path(0)).unwrap(), png);
    assert!(entry.spool.dir.join("recovery.json").exists());
    assert!(!entry.spool.output.exists());
    clean(dir, &backend, &job);
}
#[test]
fn verification_failure_retains_source_but_cancellation_still_cleans() {
    for cancelled in [false, true] {
        let (dir, backend, job) = capture(None);
        let png = discovery::fixture().unwrap();
        backend.append("fixture", &job.job_id, 0, &png).unwrap();
        let entry = backend.get(&job.job_id).unwrap();
        {
            let mut inner = entry.inner.lock().unwrap();
            inner.job.state = "encoding".into();
            inner.job.stage = "verifying".into();
            inner.job.frame_count = Some(1);
            entry.control.cancel.store(cancelled, Ordering::SeqCst);
            fail(
                &entry,
                &mut inner,
                "Decoded frame count 0, expected 1".into(),
            );
        }
        let result = backend.status(&job.job_id).unwrap();
        assert_eq!(result.state, if cancelled { "cancelled" } else { "failed" });
        assert!(!entry.spool.output.exists());
        assert!(result.actual_bytes.is_none());
        assert_eq!(entry.spool.dir.exists(), !cancelled);
        if !cancelled {
            assert_eq!(fs::read(entry.spool.frame_path(0)).unwrap(), png);
            assert!(entry.spool.dir.join("recovery.json").exists());
        }
        clean(dir, &backend, &job);
    }
}
