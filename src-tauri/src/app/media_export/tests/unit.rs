use crate::{discovery, gif, jobs::Backend, spool, types::*};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use std::{fs, path::PathBuf, sync::Arc};

pub fn root() -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("rav-tests-{}-日本語 $() ' %", uuid::Uuid::new_v4()));
    fs::create_dir(&dir).unwrap();
    dir
}
pub fn request(path: PathBuf, format: Format) -> BeginRequest {
    serde_json::from_value(json!({ "format": format, "width": 64, "height": 64,
        "fps": { "numerator": 20, "denominator": 1 }, "output_path": path,
        "source_identity": { "path": "資料/émoji.riv", "sha256": "test" }, "source_session": "fixture" }))
    .unwrap()
}
#[test]
fn save_dialog_suggestions_are_format_specific_and_filename_safe() {
    assert_eq!(
        suggested_output_file_name(Format::H264, Some("trackmap-timeline")),
        "trackmap-timeline.mp4"
    );
    assert_eq!(
        suggested_output_file_name(Format::Webm, Some("trackmap.webm")),
        "trackmap.webm"
    );
    assert_eq!(
        suggested_output_file_name(Format::Png, Some("../../unsafe?<name>")),
        "unsafe--name.png"
    );
    assert_eq!(
        suggested_output_file_name(Format::Gif, Some("  ...  ")),
        "animation.gif"
    );
}
fn backend() -> Arc<Backend> {
    Backend::new(discovery::Discovery {
        binaries: None,
        capabilities: json!({
        "formats": [{ "id": "png", "available": true }], "gif": {} }),
    })
    .unwrap()
}
#[test]
fn strict_options_and_capability_validation() {
    let mut r = request(PathBuf::from("/tmp/test.mp4"), Format::H264);
    r.alpha = true;
    assert!(r.validate().is_err());
    r.alpha = false;
    r.width = 65;
    assert!(r.validate().is_err());
    r.width = 64;
    r.fps.denominator = 0;
    assert!(r.validate().is_err());
    r.fps.denominator = 1;
    r.background = "#ff00ff;movie=http://attacker".into();
    assert!(r.validate().is_err());
    r.background = "#000000".into();
    r.width = 4096;
    r.height = 4096;
    assert!(r.validate().is_err());
    let mut raw = serde_json::to_value(request(PathBuf::from("/tmp/a.png"), Format::Png)).unwrap();
    raw["encoder_args"] = json!(["-i", "http://attacker"]);
    assert!(serde_json::from_value::<BeginRequest>(raw).is_err());
}
#[test]
fn png_requires_full_valid_decode_and_dimensions() {
    let bytes = discovery::fixture().unwrap();
    spool::sanitize_png(&bytes, 64, 64).unwrap();
    assert!(spool::sanitize_png(&bytes, 32, 64).is_err());
    assert!(spool::sanitize_png(&bytes[..bytes.len() - 4], 64, 64).is_err());
    let mut corrupt = bytes.clone();
    corrupt[50] ^= 0x80;
    assert!(spool::sanitize_png(&corrupt, 64, 64).is_err());
    let mut trailing = bytes;
    trailing.push(0);
    assert!(spool::sanitize_png(&trailing, 64, 64).is_err());
}
#[test]
fn browser_exif_is_crc_checked_then_stripped_without_parsing() {
    // Generated, non-private TIFF orientation metadata matching WebKit's eXIf chunk class.
    let mut exif = vec![0; 68];
    exif[..26].copy_from_slice(&[
        73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
    ]);
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, 64, 64);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    writer
        .write_chunk(png::chunk::ChunkType(*b"eXIf"), &exif)
        .unwrap();
    writer.write_image_data(&vec![128; 64 * 64 * 4]).unwrap();
    writer.finish().unwrap();
    let sanitized = spool::sanitize_png(&bytes, 64, 64).unwrap();
    assert!(!sanitized.windows(4).any(|w| w == b"eXIf"));
    spool::sanitize_png(&sanitized, 64, 64).unwrap();
    let location = bytes.windows(4).position(|w| w == b"eXIf").unwrap();
    bytes[location + 10] ^= 1;
    assert!(spool::sanitize_png(&bytes, 64, 64)
        .unwrap_err()
        .contains("CRC"));
}
#[test]
fn holds_and_sampling_preserve_source_duration() {
    let fps = Rate {
        numerator: 30_000,
        denominator: 1001,
    };
    let mut r = request(PathBuf::from("/tmp/x.gif"), Format::Gif);
    r.fps = fps;
    r.gif = Some(GifOptions {
        max_bytes: Some(100),
        size_policy: Some("quality_fps_scale".into()),
        ..Default::default()
    });
    let attempts = gif::attempts(&r, 101);
    assert_eq!(attempts.len(), 5);
    for a in attempts {
        assert!((a.count as f64 / a.rate.value() - 101.0 / fps.value()).abs() < 1e-9);
    }
}
#[test]
fn atomic_publish_never_clobbers_a_racer() {
    let dir = root();
    let target = dir.join("race.png");
    let id = uuid::Uuid::new_v4().to_string();
    let spool = spool::Spool::new(&id, target.to_str().unwrap(), Format::Png, false).unwrap();
    let candidate = spool.dir.join("candidate.png");
    fs::write(&candidate, b"ours").unwrap();
    fs::write(&target, b"racer").unwrap();
    assert!(spool.publish(&candidate, false).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"racer");
    spool.publish(&candidate, true).unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"ours");
    spool.clean().unwrap();
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn bounded_jobs_order_cancel_zero_and_terminal_retention() {
    let dir = root();
    let backend = backend();
    let r = request(dir.join("empty.png"), Format::Png);
    let job = backend.begin(r.clone()).unwrap();
    assert_eq!(job.stage, "capturing");
    let mut legacy = serde_json::to_value(&job).unwrap();
    legacy.as_object_mut().unwrap().remove("stage");
    assert_eq!(serde_json::from_value::<Job>(legacy).unwrap().stage, "");
    assert!(backend.begin(r).is_err());
    let frame = |index| FrameRequest {
        job_id: job.job_id.clone(),
        frame_index: index,
        png_base64: STANDARD.encode(discovery::fixture().unwrap()),
    };
    assert!(backend.frame(frame(1)).is_err());
    backend.frame(frame(0)).unwrap();
    assert!(backend.frame(frame(0)).is_err());
    assert!(backend.frame(frame(1)).is_err());
    assert!(backend.frame(frame(36_000)).is_err());
    assert!(backend
        .finish(FinishRequest {
            job_id: job.job_id.clone(),
            frame_count: 0
        })
        .is_err());
    assert!(backend
        .finish(FinishRequest {
            job_id: job.job_id.clone(),
            frame_count: 2
        })
        .is_err());
    assert_eq!(backend.cancel(&job.job_id).unwrap().state, "cancelled");
    assert_eq!(backend.cancel(&job.job_id).unwrap().state, "cancelled");
    assert_eq!(backend.status(&job.job_id).unwrap().stage, "cancelled");
    assert!(!dir.join(format!(".rav-media-{}", job.job_id)).exists());
    for i in 0..35 {
        let job = backend
            .begin(request(dir.join(format!("empty{i}.png")), Format::Png))
            .unwrap();
        let done = backend
            .finish(FinishRequest {
                job_id: job.job_id,
                frame_count: 0,
            })
            .unwrap();
        assert_eq!(done.state, "failed");
        assert_eq!(done.stage, "failed");
        assert!(done.progress < 1.0);
        assert!(done.error.unwrap().contains("zero-frame"));
    }
    assert!(backend.status(&job.job_id).is_err());
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn checksum_failure_never_executes_and_paths_are_strict() {
    let dir = root();
    let path = dir.join("fake-encoder");
    fs::write(&path, b"not an executable").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let pin = discovery::TrustedBinary {
        path,
        sha256: "0".repeat(64),
        size_bytes: 17,
    };
    let caps = discovery::discover(Some(&discovery::EncoderConfig {
        ffmpeg: pin.clone(),
        ffprobe: pin,
        gifski: None,
        provenance: "test".into(),
        distribution: None,
    }));
    assert!(caps.binaries.is_none());
    assert!(caps.capabilities["formats"]
        .as_array()
        .unwrap()
        .iter()
        .all(|f| f["available"] == false));
    let id = uuid::Uuid::new_v4().to_string();
    assert!(spool::Spool::new(&id, "relative.png", Format::Png, false).is_err());
    assert!(spool::Spool::new(
        &id,
        dir.join("wrong.jpg").to_str().unwrap(),
        Format::Png,
        false
    )
    .is_err());
    for (format, name) in [(Format::Apng, "animated.png"), (Format::Jpg, "still.jpeg")] {
        let item = spool::Spool::new(
            &uuid::Uuid::new_v4().to_string(),
            dir.join(name).to_str().unwrap(),
            format,
            false,
        )
        .unwrap();
        item.clean().unwrap();
    }
    #[cfg(unix)]
    {
        let target = dir.join("target.png");
        let link = dir.join("link.png");
        fs::write(&target, b"keep").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(spool::Spool::new(&id, link.to_str().unwrap(), Format::Png, true).is_err());
        assert_eq!(fs::read(target).unwrap(), b"keep");
    }
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn simultaneous_no_clobber_writers_have_exactly_one_winner() {
    let dir = root();
    let target = dir.join("winner.png");
    let gate = Arc::new(std::sync::Barrier::new(2));
    let mut handles = Vec::new();
    for value in [b"first".as_slice(), b"second".as_slice()] {
        let spool = spool::Spool::new(
            &uuid::Uuid::new_v4().to_string(),
            target.to_str().unwrap(),
            Format::Png,
            false,
        )
        .unwrap();
        let candidate = spool.dir.join("candidate.png");
        fs::write(&candidate, value).unwrap();
        let gate = gate.clone();
        handles.push(std::thread::spawn(move || {
            gate.wait();
            let result = spool.publish(&candidate, false).is_ok();
            spool.clean().unwrap();
            result
        }));
    }
    assert_eq!(
        handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .filter(|won| *won)
            .count(),
        1
    );
    assert!([b"first".as_slice(), b"second".as_slice()]
        .contains(&fs::read(&target).unwrap().as_slice()));
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn startup_reaps_dead_owner_without_touching_live_spools() {
    let dir = root();
    let id = uuid::Uuid::new_v4().to_string();
    let spool = spool::Spool::new(
        &id,
        dir.join("abandoned.png").to_str().unwrap(),
        Format::Png,
        false,
    )
    .unwrap();
    spool::reap_abandoned().unwrap();
    assert!(spool.dir.exists());
    let journal = std::env::temp_dir().join("rav-media-export-v1").join(&id);
    fs::write(&journal, json!({"path":spool.dir,"pid":0}).to_string()).unwrap();
    spool::reap_abandoned().unwrap();
    assert!(!spool.dir.exists());
    assert!(!journal.exists());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn verification_requires_final_decode_count_and_complete_progress() {
    use crate::verify::decoded_count;
    let complete = b"frame= 2\nprogress=continue\nframe= 10\nprogress=end\n";
    assert_eq!(decoded_count(complete, Format::H265, 10).unwrap(), 10);
    assert!(decoded_count(complete, Format::H265, 11)
        .unwrap_err()
        .contains("Decoded frame count 10"));
    assert_eq!(decoded_count(complete, Format::Gif, 20).unwrap(), 10);
    for bad in [
        "",
        "frame=10\n",
        "frame=10\nprogress=continue\n",
        "frame=10\nprogress=en",
        "progress=end\n",
        "frame=0\nprogress=end\n",
        "frame=NaN\nprogress=end\n",
        "frame=4294967296\nprogress=end\n",
        "frame=10\nprogress=continue\nprogress=end\n",
        "frame=10\nprogress=end\nframe=11\n",
    ] {
        assert!(
            decoded_count(bad.as_bytes(), Format::H265, 10).is_err(),
            "{bad:?}"
        );
    }
    assert!(decoded_count(b"frame=0\nprogress=end\n", Format::Gif, 20).is_err());
}
