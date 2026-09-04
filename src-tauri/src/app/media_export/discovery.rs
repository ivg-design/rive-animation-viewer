//! Shipping must inject pinned binaries. Fixed development paths never imply redistribution rights.
use super::{
    encode, gif,
    process::{self, Control},
    spool::Spool,
    types::*,
    verify,
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Clone)]
pub struct TrustedBinary {
    pub path: PathBuf,
    pub sha256: String,
    pub size_bytes: u64,
}
#[derive(Clone, Serialize)]
pub struct DistributionComponent {
    pub id: String,
    pub version: String,
    pub source_kind: String,
    pub artifact_url: String,
    pub artifact_sha256: String,
    pub source_code_url: String,
    pub source_code_sha256: String,
    pub provenance_file: String,
    pub provenance_sha256: String,
    pub license_spdx: String,
    pub notice_files: Vec<String>,
    pub redistribution_basis: String,
    pub review_reference: String,
}
#[derive(Clone, Serialize)]
pub struct DistributionMetadata {
    pub id: String,
    pub target: String,
    pub approved_by: String,
    pub approved_at: String,
    pub review_reference: String,
    pub inventory_sha256: String,
    pub components: Vec<DistributionComponent>,
}
#[derive(Clone)]
pub struct EncoderConfig {
    pub ffmpeg: TrustedBinary,
    pub ffprobe: TrustedBinary,
    pub gifski: Option<TrustedBinary>,
    pub provenance: String,
    /// Present only for a release resource set that passed the redistribution gate.
    pub distribution: Option<DistributionMetadata>,
}
pub struct Discovery {
    pub binaries: Option<Binaries>,
    pub capabilities: Value,
}
fn checked(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        return Err("Encoder path must be absolute".into());
    }
    let path = path.canonicalize().map_err(io)?;
    let metadata = fs::metadata(&path).map_err(io)?;
    if !metadata.is_file() || metadata.len() > 512 * 1024 * 1024 {
        return Err("Invalid encoder executable".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = metadata.permissions().mode();
        if mode & 0o111 == 0 || mode & 0o002 != 0 {
            return Err("Encoder must be executable and not world-writable".into());
        }
    }
    Ok(path)
}
fn pinned(binary: &TrustedBinary) -> Result<PathBuf> {
    if binary.sha256.len() != 64 || !binary.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("A pinned SHA-256 is required for each shipping encoder".into());
    }
    let path = checked(&binary.path)?;
    if fs::metadata(&path).map_err(io)?.len() != binary.size_bytes {
        return Err("Encoder size differs from the approved manifest".into());
    }
    let mut hash = Sha256::new();
    let mut buf = [0; 65536];
    let mut file = File::open(&path).map_err(io)?;
    loop {
        let count = file.read(&mut buf).map_err(io)?;
        if count == 0 {
            break;
        }
        hash.update(&buf[..count]);
    }
    if format!("{:x}", hash.finalize()) != binary.sha256.to_ascii_lowercase() {
        return Err("Encoder checksum mismatch".into());
    }
    Ok(path)
}
fn binaries(config: Option<&EncoderConfig>) -> Result<(Binaries, &'static str)> {
    if !cfg!(any(
        target_os = "macos",
        target_os = "linux",
        target_os = "windows"
    )) {
        return Err("This platform lacks a tested native memory supervisor".into());
    }
    if let Some(c) = config {
        if c.provenance.trim().is_empty() || c.provenance.len() > 4096 {
            return Err("Binary provenance is required".into());
        }
        let origin = if c.distribution.is_some() {
            "bundled"
        } else {
            "pinned_development"
        };
        return Ok((
            Binaries {
                ffmpeg: pinned(&c.ffmpeg)?,
                ffprobe: pinned(&c.ffprobe)?,
                gifski: c.gifski.as_ref().map(pinned).transpose()?,
            },
            origin,
        ));
    }
    if cfg!(debug_assertions) {
        for root in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            if let (Ok(ffmpeg), Ok(ffprobe)) = (
                checked(&Path::new(root).join("ffmpeg")),
                checked(&Path::new(root).join("ffprobe")),
            ) {
                return Ok((
                    Binaries {
                        ffmpeg,
                        ffprobe,
                        gifski: checked(&Path::new(root).join("gifski")).ok(),
                    },
                    "development_only",
                ));
            }
        }
    }
    Err("No trusted encoder configuration; shipping binaries must be pinned and separately licensed".into())
}
pub fn fixture() -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, 64, 64);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(io)?;
    let rgba: Vec<u8> = (0..4096)
        .flat_map(|i| [220, 60, 120, if i % 64 < 16 { 0 } else { 255 }])
        .collect();
    writer.write_image_data(&rgba).map_err(io)?;
    writer.finish().map_err(io)?;
    Ok(bytes)
}
fn smoke(binaries: &Binaries, format: Format, adapter: &str) -> Result<()> {
    let id = uuid::Uuid::new_v4().to_string();
    let path = std::env::temp_dir().join(format!("rav-probe-{id}.{}", format.extension()));
    let spool = Spool::new(
        &id,
        path.to_str().ok_or("Non UTF-8 temporary path")?,
        format,
        false,
    )?;
    let result = (|| {
        fs::write(spool.frame_path(0), fixture()?).map_err(io)?;
        let control = Control::new();
        let request = BeginRequest {
            format,
            capture_codec: None,
            width: 64,
            height: 64,
            fps: Rate {
                numerator: 10,
                denominator: 1,
            },
            output_path: None,
            overwrite: false,
            alpha: format.alpha(),
            background: "#000000".into(),
            quality: 70,
            gif: (format == Format::Gif).then(GifOptions::default),
            source_identity: None,
            source_session: None,
            max_frames: None,
        };
        let count = if format.animated() { 2 } else { 1 };
        let (output, _) = if format == Format::Gif {
            gif::encode(binaries, &request, &spool, &[0], count, adapter, &control)?
        } else {
            encode::ordinary(binaries, &request, &spool, &[0], count, &control)?
        };
        verify::inspect(
            binaries,
            &output,
            verify::ExpectedOutput {
                format,
                width: 64,
                height: 64,
                frame_count: count,
                duration: count as f64 / 10.0,
                rate: 10.0,
            },
            &control,
        )?;
        if format == Format::Webm {
            let raw = process::run(
                &binaries.ffmpeg,
                &[
                    "-v",
                    "error",
                    "-nostdin",
                    "-c:v",
                    "libvpx-vp9",
                    "-i",
                    output.to_str().ok_or("Invalid output path")?,
                    "-frames:v",
                    "1",
                    "-vf",
                    "alphaextract",
                    "-pix_fmt",
                    "gray",
                    "-f",
                    "rawvideo",
                    "pipe:1",
                ]
                .map(str::to_owned),
                None,
                &control,
                20,
                &[],
            )?;
            if raw.len() != 4096 || raw[0] > 8 || raw[32] < 247 {
                return Err("WebM decoded alpha probe failed".into());
            }
        }
        Ok(())
    })();
    let cleanup = spool.clean();
    result.and(cleanup)
}
pub fn discover(config: Option<&EncoderConfig>) -> Discovery {
    let found = binaries(config);
    let (binaries, origin, failure) = match found {
        Ok((b, origin)) => (Some(b), origin, None),
        Err(e) => (None, "unavailable", Some(e)),
    };
    let mut encoders = Vec::new();
    let mut formats = Vec::new();
    let mut gifski_ok = false;
    if let Some(b) = &binaries {
        for (id, path, flag) in [
            ("ffmpeg", Some(&b.ffmpeg), "-version"),
            ("ffprobe", Some(&b.ffprobe), "-version"),
            ("gifski", b.gifski.as_ref(), "--version"),
        ] {
            if let Some(path) = path {
                let version = process::run(path, &[flag.into()], None, &Control::new(), 10, &[])
                    .map(|v| {
                        String::from_utf8_lossy(&v)
                            .lines()
                            .next()
                            .unwrap_or("")
                            .to_owned()
                    });
                let tested = if id == "gifski" {
                    smoke(b, Format::Gif, "gifski")
                } else {
                    version.as_ref().map(|_| ()).map_err(Clone::clone)
                };
                if id == "gifski" {
                    gifski_ok = tested.is_ok();
                }
                encoders.push(json!({ "id": id, "path": path, "version": version.as_ref().ok(), "origin": origin,
                    "available": tested.is_ok(), "reason": tested.err(), "provenance": config.map(|c| &c.provenance) }));
            } else {
                encoders.push(
                    json!({ "id": id, "available": false, "reason": "Executable not configured" }),
                );
            }
        }
    }
    for format in [
        Format::H264,
        Format::H265,
        Format::Webm,
        Format::Apng,
        Format::Gif,
        Format::Png,
        Format::Jpg,
        Format::Webp,
    ] {
        let test = binaries
            .as_ref()
            .ok_or_else(|| failure.clone().unwrap_or_default())
            .and_then(|b| {
                smoke(
                    b,
                    format,
                    if format == Format::Gif && gifski_ok {
                        "gifski"
                    } else {
                        "ffmpeg"
                    },
                )
            });
        formats.push(json!({ "id": format, "extension": format.extension(), "alpha": format.alpha(),
            "animated": format.animated(), "available": test.is_ok(), "reason": test.err(),
            "validation": "tiny fixture encode and full decode; webm includes decoded-alpha probe" }));
    }
    let ffmpeg_gif = binaries
        .as_ref()
        .is_some_and(|b| smoke(b, Format::Gif, "ffmpeg").is_ok());
    let distribution = config.and_then(|value| value.distribution.as_ref());
    let distribution_ready = binaries.is_some() && distribution.is_some();
    let capabilities = json!({ "formats": formats, "encoders": encoders,
        "capture_codecs": ["h264", "hevc", "vp9"], "binary_capture": true,
        "limits": { "max_active_capture": 1, "max_active_jobs": 1, "max_pending_frames": 1,
            "max_frames": null, "max_pixels": MAX_PIXELS, "max_edge": 4096, "max_fps": 60,
            "max_frame_png_bytes": MAX_PNG, "max_spool_bytes": null, "max_output_bytes": null,
            "max_encoder_rss_bytes": MAX_RSS, "rss_sample_interval_ms": 500,
            "max_duration_seconds": null, "max_job_lifetime_seconds": null,
            "disk_reserve_bytes": DISK_RESERVE, "finalization_reserve_bytes": super::spool::disk::FINAL_RESERVE, "max_capture_chunk_bytes": MAX_PNG,
            "capture_free_space_policy": "spooled_bytes + 2 * incoming_bytes + disk_reserve_bytes",
            "frame_count_storage_max": u32::MAX,
            "max_capture_idle_seconds": 120, "retained_jobs": 32 },
        "gif": { "preferred_encoder": "gifski", "resolved_auto_encoder": if gifski_ok { "gifski" } else { "ffmpeg" },
            "gifski_available": gifski_ok, "ffmpeg_available": ffmpeg_gif, "max_attempts": 5,
            "motion_quality": gifski_ok, "lossy_quality": gifski_ok, "alpha": "binary",
            "fps_min": 1, "fps_max": 50, "timing_quantum_seconds": 0.01,
            "max_gifski_input_frames": gif::gifski_frame_limit(),
            "search_min_scale": 0.5, "search_min_fps": 5, "search_min_quality_factor": 0.25,
            "size_policies": ["quality_only", "quality_fps_scale"],
            "small": { "max_edge": 480, "max_fps": 12, "quality": 60, "upscale": false },
            "balanced": { "max_edge": 960, "max_fps": 20, "quality": 80, "upscale": false },
            "notice": "gifski: AGPL-3.0-or-later or alternative commercial terms; separate process is not a license exemption." },
        "distribution": { "ready": distribution_ready, "review_required": !distribution_ready,
            "hash_verified": binaries.is_some() && matches!(origin, "bundled" | "pinned_development"),
            "origin": origin, "manifest": distribution,
            "failure": failure,
            "notice": if distribution_ready {
                "Bundled encoders passed manifest, size, SHA-256, executable and startup smoke verification. App signing/notarization must still be verified on the final bundle."
            } else {
                "No approved bundled encoder inventory is active. Development tools are never redistribution inputs."
            } }
    });
    Discovery {
        binaries,
        capabilities,
    }
}
