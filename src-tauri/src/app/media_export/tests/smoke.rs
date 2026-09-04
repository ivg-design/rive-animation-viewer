// Real-encoder acceptance tests are opt-in, never launch or build the desktop app.
use crate::{
    discovery::{self, EncoderConfig, TrustedBinary},
    jobs::Backend,
    process::{self, Control},
    types::*,
    unit::{request, root},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

fn pinned(path: impl Into<PathBuf>) -> TrustedBinary {
    let path = path.into();
    let bytes = fs::read(&path).unwrap();
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    TrustedBinary {
        path,
        sha256,
        size_bytes: bytes.len() as u64,
    }
}
pub(super) fn config(gifski: bool) -> EncoderConfig {
    EncoderConfig {
        ffmpeg: pinned("/opt/homebrew/bin/ffmpeg"),
        ffprobe: pinned("/opt/homebrew/bin/ffprobe"),
        gifski: gifski.then(|| {
            pinned(
                std::env::var("RAV_TEST_GIFSKI")
                    .expect("Set RAV_TEST_GIFSKI to a verification-only executable"),
            )
        }),
        provenance:
            "LOCAL TEST ONLY: installed FFmpeg; optional temporary gifski; NOT a redistribution manifest"
                .into(),
        distribution: None,
    }
}
fn png(color: [u8; 3]) -> String {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, 64, 64);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    let rgba: Vec<u8> = (0..4096)
        .flat_map(|i| {
            [
                color[0],
                color[1],
                color[2],
                if i % 64 < 16 {
                    0
                } else if i % 64 < 32 {
                    128
                } else {
                    255
                },
            ]
        })
        .collect();
    writer.write_image_data(&rgba).unwrap();
    writer.finish().unwrap();
    STANDARD.encode(bytes)
}
pub(super) fn wait(backend: &Arc<Backend>, id: &str) -> Job {
    let start = Instant::now();
    loop {
        let job = backend.status(id).unwrap();
        if job.state != "completed" {
            assert!(job.progress < 1.0, "{job:?}");
        }
        if job.state == "encoding" {
            assert!(
                ["preparing", "encoding", "verifying", "publishing"].contains(&job.stage.as_str())
            );
            match job.stage.as_str() {
                "preparing" | "encoding" => assert!((0.05..=0.85).contains(&job.progress)),
                "verifying" => assert!((0.90..=0.99).contains(&job.progress)),
                "publishing" => assert_eq!(job.progress, 0.99),
                _ => unreachable!(),
            }
        }
        if ["completed", "failed", "cancelled"].contains(&job.state.as_str()) {
            assert_eq!(job.stage, job.state);
            return job;
        }
        assert!(
            start.elapsed() < Duration::from_secs(120),
            "Job did not settle"
        );
        thread::sleep(Duration::from_millis(30));
    }
}
pub(super) fn export(backend: &Arc<Backend>, r: BeginRequest, count: u32) -> Job {
    let job = backend.begin(r).unwrap();
    assert_eq!(job.stage, "capturing");
    for (index, color) in [(0, [220, 60, 120]), (3, [40, 210, 80]), (8, [60, 80, 220])] {
        if index >= count {
            continue;
        }
        backend
            .frame(FrameRequest {
                job_id: job.job_id.clone(),
                frame_index: index,
                png_base64: png(color),
            })
            .unwrap();
    }
    let start = Instant::now();
    let encoding = backend
        .finish(FinishRequest {
            job_id: job.job_id.clone(),
            frame_count: count,
        })
        .unwrap();
    assert_eq!(encoding.state, "encoding");
    assert_eq!(encoding.stage, "preparing");
    assert_eq!(encoding.progress, 0.05);
    assert!(start.elapsed() < Duration::from_millis(250));
    let finished = wait(backend, &job.job_id);
    assert_eq!(finished.state, "completed", "{:?}", finished);
    assert_eq!(finished.stage, "completed");
    assert_eq!(finished.progress, 1.0);
    assert!(Path::new(finished.output_path.as_ref().unwrap()).is_file());
    for key in ["capture_seconds", "encode_seconds", "verify_seconds"] {
        assert!(finished.resolved_settings[key]
            .as_f64()
            .is_some_and(|v| v.is_finite() && v >= 0.0));
    }
    finished
}
fn decode(backend: &Backend, path: &Path, format: Format) -> Vec<u8> {
    let binary = &backend.discovery.binaries.as_ref().unwrap().ffmpeg;
    let mut args = process::strings(&["-v", "error", "-nostdin"]);
    if format == Format::Webm {
        args.extend(process::strings(&["-c:v", "libvpx-vp9"]));
    }
    if format == Format::Apng {
        args.extend(process::strings(&["-f", "apng", "-ignore_loop", "1"]));
    }
    args.extend([
        "-i".into(),
        path.to_string_lossy().into_owned(),
        "-pix_fmt".into(),
        "rgba".into(),
        "-fps_mode".into(),
        "passthrough".into(),
        "-f".into(),
        "rawvideo".into(),
        "pipe:1".into(),
    ]);
    process::run(binary, &args, None, &Control::new(), 30, &[]).unwrap()
}

mod artifacts;
mod encoder_matrix;
mod gifski_matrix;
