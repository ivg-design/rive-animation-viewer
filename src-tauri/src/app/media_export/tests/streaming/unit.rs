use crate::{
    discovery,
    jobs::Backend,
    process::Control,
    spool,
    types::*,
    unit::{request, root},
};
use serde_json::json;
use std::{
    fs,
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

fn backend() -> Arc<Backend> {
    Backend::new(discovery::Discovery {
        binaries: None,
        capabilities: json!({
        "formats": [{"id":"png","available":true},{"id":"h264","available":true},
            {"id":"h265","available":true},{"id":"webm","available":true}] }),
    })
    .unwrap()
}
pub(super) fn packet(records: &[&[u8]]) -> Vec<u8> {
    let mut bytes = (records.len() as u32).to_le_bytes().to_vec();
    for record in records {
        bytes.extend_from_slice(&(record.len() as u32).to_le_bytes());
        bytes.extend_from_slice(record);
    }
    bytes
}
#[test]
fn encoded_request_requires_matching_opaque_format_and_session() {
    let dir = root();
    for (format, codec) in [
        (Format::H264, "h264"),
        (Format::H265, "hevc"),
        (Format::Webm, "vp9"),
    ] {
        let mut r = request(dir.join(format!("out.{}", format.extension())), format);
        r.capture_codec = Some(codec.into());
        r.validate().unwrap();
        r.alpha = true;
        assert!(r.validate().is_err());
        r.alpha = false;
        r.source_session = None;
        assert!(r.validate().is_err());
        r.source_session = Some(json!(42));
        assert!(r.validate().is_err());
        r.source_session = Some(json!("fixture"));
        r.capture_codec = Some("png".into());
        assert!(r.validate().is_err());
    }
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn direct_png_auth_order_and_disk_journal_have_no_duration_limit() {
    let dir = root();
    let backend = backend();
    let mut r = request(dir.join("long.mp4"), Format::H264);
    r.max_frames = Some(1); // Obsolete host cap must not shorten a disk-driven capture.
    let job = backend.begin(r).unwrap();
    let png = discovery::fixture().unwrap();
    assert!(backend.append("other", &job.job_id, 0, &png).is_err());
    assert!(backend.append("fixture", &job.job_id, 1, &png).is_err());
    assert_eq!(
        backend
            .append("fixture", &job.job_id, 0, &png)
            .unwrap()
            .received_frames,
        1
    );
    assert!(backend.append("fixture", &job.job_id, 0, &png).is_err());
    let receipt = backend
        .append("fixture", &job.job_id, 36_001, &png)
        .unwrap();
    assert_eq!(receipt.received_frames, 2);
    let capture = spool::Spool::new(
        &uuid::Uuid::new_v4().to_string(),
        dir.join("sample.mp4").to_str().unwrap(),
        Format::H264,
        false,
    )
    .unwrap();
    for index in [0u32, 36_001] {
        fs::write(capture.frame_path(index), &png).unwrap();
        spool::record_index(&capture, index).unwrap();
    }
    let seq = spool::capture_sequence(&capture, &[], 36_002, 2, &Control::new()).unwrap();
    assert_eq!(fs::read(seq.join("000001.png")).unwrap(), png);
    capture.clean().unwrap();
    assert_eq!(backend.cancel(&job.job_id).unwrap().stage, "cancelled");
    assert!(backend
        .append("fixture", &job.job_id, 36_002, &png)
        .is_err());
    let old = Control {
        born: Instant::now() - Duration::from_secs(7200),
        ..Control::new()
    };
    old.check().unwrap();
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn encoded_packets_are_contiguous_atomic_and_never_generate_holds() {
    let dir = root();
    let backend = backend();
    let mut r = request(dir.join("stream.mp4"), Format::H264);
    r.capture_codec = Some("h264".into());
    let job = backend.begin(r).unwrap();
    let unit = &[0, 0, 0, 1, 0x65, 0x80][..];
    let body = packet(&[unit, unit]);
    assert!(backend.append("wrong", &job.job_id, 0, &body).is_err());
    assert!(backend.append("fixture", &job.job_id, 1, &body).is_err());
    for bad in [
        vec![],
        vec![1, 0, 0, 0],
        packet(&[&[]]),
        packet(&[b"HVCC"]),
        {
            let mut b = body.clone();
            b.push(0);
            b
        },
        body[..body.len() - 1].to_vec(),
    ] {
        assert!(backend.append("fixture", &job.job_id, 0, &bad).is_err());
        assert_eq!(backend.status(&job.job_id).unwrap().received_frames, 0);
    }
    assert_eq!(
        backend
            .append("fixture", &job.job_id, 0, &body)
            .unwrap()
            .received_frames,
        2
    );
    assert!(backend.append("fixture", &job.job_id, 0, &body).is_err());
    let source = dir.join(format!(".rav-media-{}/capture.annexb", job.job_id));
    let aud = &[0, 0, 0, 1, 9, 0xf0][..];
    assert_eq!(fs::read(&source).unwrap(), [aud, unit, aud, unit].concat());
    // Finish cannot replace a missing encoded presentation slot with a hold.
    let done = backend
        .finish(FinishRequest {
            job_id: job.job_id.clone(),
            frame_count: 3,
        })
        .unwrap();
    assert_eq!(done.stage, "failed");
    assert!(done.error.unwrap().contains("never inserts holds"));
    assert!(!source.exists());
    assert!(!dir.join("stream.mp4").exists());
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn vp9_ivf_fps_timestamps_and_large_capture_counts_are_native() {
    let dir = root();
    let backend = backend();
    let mut r = request(dir.join("stream.webm"), Format::Webm);
    r.capture_codec = Some("vp9".into());
    r.fps = Rate {
        numerator: 30_000,
        denominator: 1001,
    };
    let job = backend.begin(r).unwrap();
    let count = 36_001;
    let records = vec![&[0x82u8][..]; count];
    let receipt = backend
        .append("fixture", &job.job_id, 0, &packet(&records))
        .unwrap();
    assert_eq!(receipt.received_frames, count as u32);
    let bytes = fs::read(dir.join(format!(".rav-media-{}/capture.ivf", job.job_id))).unwrap();
    assert_eq!(&bytes[..4], b"DKIF");
    assert_eq!(&bytes[8..12], b"VP90");
    assert_eq!(
        u32::from_le_bytes(bytes[16..20].try_into().unwrap()),
        30_000
    );
    assert_eq!(u32::from_le_bytes(bytes[20..24].try_into().unwrap()), 1001);
    assert_eq!(u64::from_le_bytes(bytes[36..44].try_into().unwrap()), 0);
    assert_eq!(u64::from_le_bytes(bytes[49..57].try_into().unwrap()), 1);
    assert_eq!(backend.cancel(&job.job_id).unwrap().stage, "cancelled");
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn low_disk_fails_capture_and_large_sparse_output_has_no_size_cap() {
    let dir = root();
    let backend = backend();
    spool::disk::with_available(DISK_RESERVE - 1, || {
        assert!(backend
            .begin(request(dir.join("low.png"), Format::Png))
            .is_err());
    });
    let job = backend
        .begin(request(dir.join("later.png"), Format::Png))
        .unwrap();
    spool::disk::with_available(DISK_RESERVE, || {
        assert!(backend
            .append("fixture", &job.job_id, 0, &discovery::fixture().unwrap())
            .unwrap_err()
            .contains("disk"));
    });
    assert_eq!(backend.status(&job.job_id).unwrap().stage, "failed");
    assert!(!dir.join(format!(".rav-media-{}", job.job_id)).exists());
    let spool = spool::Spool::new(
        &uuid::Uuid::new_v4().to_string(),
        dir.join("large.mp4").to_str().unwrap(),
        Format::H264,
        false,
    )
    .unwrap();
    let candidate = spool.dir.join("candidate.mp4");
    fs::File::create(&candidate)
        .unwrap()
        .set_len(3 * 1024 * 1024 * 1024)
        .unwrap();
    assert_eq!(
        spool.publish(&candidate, false).unwrap(),
        3 * 1024 * 1024 * 1024
    );
    spool.clean().unwrap();
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn reaper_preserves_old_live_owner_and_unknown_legacy_records() {
    let dir = root();
    let id = uuid::Uuid::new_v4().to_string();
    let capture = spool::Spool::new(
        &id,
        dir.join("old.png").to_str().unwrap(),
        Format::Png,
        false,
    )
    .unwrap();
    let journal = std::env::temp_dir().join("rav-media-export-v1").join(&id);
    let old = SystemTime::UNIX_EPOCH + Duration::from_secs(1);
    fs::File::options()
        .write(true)
        .open(&journal)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(old))
        .unwrap();
    spool::reap_abandoned().unwrap();
    assert!(capture.dir.exists());
    fs::write(&journal, capture.dir.to_str().unwrap()).unwrap();
    fs::File::options()
        .write(true)
        .open(&journal)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(old))
        .unwrap();
    spool::reap_abandoned().unwrap();
    assert!(capture.dir.exists());
    capture.clean().unwrap();
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn long_gif_auto_falls_back_but_explicit_controls_are_not_ignored() {
    let mut r = request(std::path::PathBuf::from("/tmp/long.gif"), Format::Gif);
    let count = crate::gif::gifski_frame_limit() + 1;
    assert_eq!(
        crate::gif::bounded_adapter(&r, "gifski", count).unwrap(),
        "ffmpeg"
    );
    r.gif = Some(GifOptions {
        encoder: "gifski".into(),
        ..Default::default()
    });
    assert!(crate::gif::bounded_adapter(&r, "gifski", count).is_err());
    r.gif = Some(GifOptions {
        motion_quality: Some(80),
        ..Default::default()
    });
    assert!(crate::gif::bounded_adapter(&r, "gifski", count).is_err());
    r.gif = Some(GifOptions {
        lossy_quality: Some(80),
        ..Default::default()
    });
    assert!(crate::gif::bounded_adapter(&r, "gifski", count).is_err());
}

#[test]
fn concurrent_reapers_and_owner_cleanup_tolerate_disappearing_entries() {
    let dir = root();
    let live = spool::Spool::new(
        &uuid::Uuid::new_v4().to_string(),
        dir.join("live.png").to_str().unwrap(),
        Format::Png,
        false,
    )
    .unwrap();
    let mut captures = Vec::new();
    for index in 0..32 {
        let id = uuid::Uuid::new_v4().to_string();
        let capture = spool::Spool::new(
            &id,
            dir.join(format!("dead-{index}.png")).to_str().unwrap(),
            Format::Png,
            false,
        )
        .unwrap();
        fs::write(capture.dir.join("frame.png"), b"owned data").unwrap();
        let journal = std::env::temp_dir().join("rav-media-export-v1").join(id);
        fs::write(journal, json!({"path":capture.dir,"pid":0}).to_string()).unwrap();
        captures.push(capture);
    }
    let gate = Arc::new(std::sync::Barrier::new(5));
    std::thread::scope(|scope| {
        for _ in 0..4 {
            let gate = gate.clone();
            scope.spawn(move || {
                gate.wait();
                for _ in 0..16 {
                    spool::reap_abandoned().unwrap();
                }
            });
        }
        gate.wait();
        // Job cleanup competes with multiple reapers over the same entries.
        for capture in &captures {
            capture.clean().unwrap();
        }
    });
    assert!(live.dir.exists());
    assert!(captures.iter().all(|capture| !capture.dir.exists()));
    live.clean().unwrap();
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn reaper_skips_dangling_journal_symlinks_without_following_them() {
    let dir = root();
    let id = uuid::Uuid::new_v4().to_string();
    let capture = spool::Spool::new(
        &id,
        dir.join("live.png").to_str().unwrap(),
        Format::Png,
        false,
    )
    .unwrap();
    let journal = std::env::temp_dir()
        .join("rav-media-export-v1")
        .join(uuid::Uuid::new_v4().to_string());
    std::os::unix::fs::symlink(dir.join("missing-target"), &journal).unwrap();
    spool::reap_abandoned().unwrap();
    assert!(fs::symlink_metadata(&journal)
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(capture.dir.exists());
    fs::remove_file(journal).unwrap();
    capture.clean().unwrap();
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn png_storage_failure_preserves_accepted_prefix_and_recovery_descriptor() {
    let dir = root();
    let backend = backend();
    let job = backend
        .begin(request(dir.join("recover.mp4"), Format::H264))
        .unwrap();
    let png = discovery::fixture().unwrap();
    backend.append("fixture", &job.job_id, 0, &png).unwrap();
    let capture = dir.join(format!(".rav-media-{}", job.job_id));
    // Force a genuine create_new I/O failure after one acknowledged frame.
    fs::create_dir(capture.join("master-000001.png")).unwrap();
    assert!(backend
        .append("fixture", &job.job_id, 1, &png)
        .unwrap_err()
        .contains("storage I/O"));
    let failed = backend.status(&job.job_id).unwrap();
    assert_eq!(failed.stage, "failed");
    assert_eq!(failed.received_frames, 1);
    assert_eq!(fs::read(capture.join("master-000000.png")).unwrap(), png);
    assert_eq!(
        fs::read(capture.join("frames.idx")).unwrap(),
        0u32.to_le_bytes()
    );
    let recovery: serde_json::Value =
        serde_json::from_slice(&fs::read(capture.join("recovery.json")).unwrap()).unwrap();
    assert_eq!(recovery["frame_count"], 1);
    assert_eq!(recovery["accepted_prefix_repaired"], true);
    let journal = std::env::temp_dir()
        .join("rav-media-export-v1")
        .join(&job.job_id);
    let mut marker: serde_json::Value =
        serde_json::from_slice(&fs::read(&journal).unwrap()).unwrap();
    marker["pid"] = json!(0);
    fs::write(&journal, marker.to_string()).unwrap();
    spool::reap_abandoned().unwrap();
    assert!(capture.exists());
    assert!(!dir.join("recover.mp4").exists());
    fs::remove_file(journal).unwrap();
    fs::remove_dir_all(dir).unwrap();
}
