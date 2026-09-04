//! Opt-in real remux tests; never launch the desktop or depend on a WebView.
use crate::{
    discovery,
    jobs::Backend,
    process::{self, Control},
    smoke::{config, export, wait},
    spool,
    streaming_unit::packet,
    types::*,
    unit::{request, root},
};
use std::{fs, path::Path};

fn access_unit(backend: &Backend, path: &Path, format: Format) -> Vec<u8> {
    let binaries = backend.discovery.binaries.as_ref().unwrap();
    let mut args = process::strings(&["-v", "error", "-nostdin", "-i"]);
    args.push(path.to_string_lossy().into_owned());
    args.extend(process::strings(&["-map", "0:v:0", "-an", "-c:v", "copy"]));
    let demux = match format {
        Format::H264 => {
            args.extend(process::strings(&["-bsf:v", "h264_mp4toannexb"]));
            "h264"
        }
        Format::H265 => {
            args.extend(process::strings(&["-bsf:v", "hevc_mp4toannexb"]));
            "hevc"
        }
        Format::Webm => "ivf",
        _ => unreachable!(),
    };
    args.extend(process::strings(&["-f", demux, "pipe:1"]));
    let bytes = process::run(&binaries.ffmpeg, &args, None, &Control::new(), 30, &[]).unwrap();
    if format == Format::Webm {
        assert_eq!(&bytes[..4], b"DKIF");
        let length = u32::from_le_bytes(bytes[32..36].try_into().unwrap()) as usize;
        bytes[44..44 + length].to_vec()
    } else {
        bytes
    }
}
#[test]
#[ignore = "requires real FFmpeg/ffprobe"]
fn encoded_stream_remux_matrix_and_partial_disk_stop() {
    let dir = root();
    let backend = Backend::new(discovery::discover(Some(&config(false)))).unwrap();
    for (format, codec) in [
        (Format::H264, "h264"),
        (Format::H265, "hevc"),
        (Format::Webm, "vp9"),
    ] {
        let fixture = dir.join(format!("fixture-{codec}.{}", format.extension()));
        export(&backend, request(fixture.clone(), format), 1);
        let unit = access_unit(&backend, &fixture, format);
        let output = dir.join(format!("stream-{codec}.{}", format.extension()));
        let mut r = request(output.clone(), format);
        r.capture_codec = Some(codec.into());
        let job = backend.begin(r.clone()).unwrap();
        let first = backend
            .append("fixture", &job.job_id, 0, &packet(&[&unit, &unit]))
            .unwrap();
        assert_eq!(first.frame_count, 2);
        let third = backend
            .append("fixture", &job.job_id, 1, &packet(&[&unit]))
            .unwrap();
        assert_eq!(third.frame_count, 3);
        backend
            .finish(FinishRequest {
                job_id: job.job_id.clone(),
                frame_count: 3,
            })
            .unwrap();
        let done = wait(&backend, &job.job_id);
        assert_eq!(done.stage, "completed", "{done:?}");
        assert_eq!(done.resolved_settings["stream_copy"], true);
        assert_eq!(done.resolved_settings["verification"]["decoded_frames"], 3);
        assert!(!done.warnings.iter().any(|w| w.contains("hold preceding")));
        let partial_path = dir.join(format!("partial-{codec}.{}", format.extension()));
        r.output_path = Some(partial_path.to_string_lossy().into_owned());
        let partial = backend.begin(r).unwrap();
        let accepted = backend
            .append("fixture", &partial.job_id, 0, &packet(&[&unit, &unit]))
            .unwrap();
        let stopped = spool::disk::with_available(DISK_RESERVE + accepted.bytes_spooled, || {
            backend
                .append("fixture", &partial.job_id, 1, &packet(&[&unit]))
                .unwrap()
        });
        assert_eq!(stopped.stop_reason.as_deref(), Some("disk_space"));
        assert_eq!(stopped.frame_count, 2);
        assert_eq!(stopped.bytes_spooled, accepted.bytes_spooled);
        let tail = backend
            .append("fixture", &partial.job_id, 2, &packet(&[&unit]))
            .unwrap();
        assert_eq!(tail.stop_reason, stopped.stop_reason);
        assert_eq!(tail.received_frames, 2);
        assert!(backend
            .finish(FinishRequest {
                job_id: partial.job_id.clone(),
                frame_count: 3
            })
            .is_err());
        backend
            .finish(FinishRequest {
                job_id: partial.job_id.clone(),
                frame_count: 2,
            })
            .unwrap();
        let done = wait(&backend, &partial.job_id);
        assert_eq!(done.stage, "completed", "{done:?}");
        assert!(partial_path.is_file());
        assert_eq!(done.resolved_settings["verification"]["decoded_frames"], 2);
        assert!(done
            .warnings
            .iter()
            .any(|w| w.contains("partial recording")));
    }
    fs::remove_dir_all(dir).unwrap();
}
#[test]
#[ignore = "requires real FFmpeg/ffprobe"]
fn raw_png_disk_stop_preserves_gap_count_and_finishes_partial() {
    let dir = root();
    let backend = Backend::new(discovery::discover(Some(&config(false)))).unwrap();
    let output = dir.join("partial.mp4");
    let job = backend
        .begin(request(output.clone(), Format::H264))
        .unwrap();
    let png = discovery::fixture().unwrap();
    backend.append("fixture", &job.job_id, 0, &png).unwrap();
    let accepted = backend.append("fixture", &job.job_id, 3, &png).unwrap();
    let stopped = spool::disk::with_available(DISK_RESERVE + accepted.bytes_spooled, || {
        backend.append("fixture", &job.job_id, 6, &png).unwrap()
    });
    assert_eq!(stopped.stop_reason.as_deref(), Some("disk_space"));
    assert_eq!(stopped.frame_count, 4);
    assert_eq!(stopped.received_frames, 2);
    assert_eq!(stopped.bytes_spooled, accepted.bytes_spooled);
    assert!(!dir
        .join(format!(".rav-media-{}/master-000006.png", job.job_id))
        .exists());
    assert_eq!(
        backend
            .append("fixture", &job.job_id, 7, &png)
            .unwrap()
            .frame_count,
        4
    );
    backend
        .finish(FinishRequest {
            job_id: job.job_id.clone(),
            frame_count: 4,
        })
        .unwrap();
    let done = wait(&backend, &job.job_id);
    assert_eq!(done.stage, "completed", "{done:?}");
    assert_eq!(done.resolved_settings["verification"]["decoded_frames"], 4);
    assert!(output.is_file());
    fs::remove_dir_all(dir).unwrap();
}
#[test]
#[ignore = "requires real FFmpeg/ffprobe"]
fn corrupt_encoded_stream_and_false_record_count_never_publish() {
    let dir = root();
    let backend = Backend::new(discovery::discover(Some(&config(false)))).unwrap();
    let fixture = dir.join("fixture.mp4");
    export(&backend, request(fixture.clone(), Format::H264), 1);
    let unit = access_unit(&backend, &fixture, Format::H264);
    for (name, record) in [
        ("corrupt", vec![0, 0, 0, 1, 0x65]),
        ("wrong-count", [&unit[..], &unit[..]].concat()),
    ] {
        let output = dir.join(format!("{name}.mp4"));
        let mut r = request(output.clone(), Format::H264);
        r.capture_codec = Some("h264".into());
        let job = backend.begin(r).unwrap();
        backend
            .append("fixture", &job.job_id, 0, &packet(&[&record]))
            .unwrap();
        backend
            .finish(FinishRequest {
                job_id: job.job_id.clone(),
                frame_count: 1,
            })
            .unwrap();
        let done = wait(&backend, &job.job_id);
        assert_eq!(done.stage, "failed", "{done:?}");
        assert!(!output.exists());
        // Failure retains accepted source for diagnosis/recovery, never publishes it.
        let capture = dir.join(format!(".rav-media-{}", job.job_id));
        assert!(capture.join("capture.annexb").is_file());
        assert!(capture.join("recovery.json").is_file());
        assert!(done.actual_bytes.is_none());
        fs::remove_file(
            std::env::temp_dir()
                .join("rav-media-export-v1")
                .join(&job.job_id),
        )
        .unwrap();
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
#[ignore = "requires real FFmpeg/ffprobe"]
fn renderer_abort_retained_streams_remux_and_strictly_decode() {
    let dir = root();
    let backend = Backend::new(discovery::discover(Some(&config(false)))).unwrap();
    for (format, codec) in [
        (Format::H264, "h264"),
        (Format::H265, "hevc"),
        (Format::Webm, "vp9"),
    ] {
        let fixture = dir.join(format!("abort-fixture-{codec}.{}", format.extension()));
        export(&backend, request(fixture.clone(), format), 1);
        let unit = access_unit(&backend, &fixture, format);
        let output = dir.join(format!("aborted-{codec}.{}", format.extension()));
        let mut r = request(output.clone(), format);
        r.capture_codec = Some(codec.into());
        let job = backend.begin(r).unwrap();
        backend
            .append("fixture", &job.job_id, 0, &packet(&[&unit, &unit]))
            .unwrap();
        let capture = dir.join(format!(".rav-media-{}", job.job_id));
        let source = capture.join(if codec == "vp9" {
            "capture.ivf"
        } else {
            "capture.annexb"
        });
        // Simulate an unacknowledged partial write beyond the accepted packet.
        use std::io::Write;
        fs::OpenOptions::new()
            .append(true)
            .open(&source)
            .unwrap()
            .write_all(b"incomplete tail")
            .unwrap();
        let aborted = backend
            .abort(AbortRequest {
                job_id: job.job_id.clone(),
                error: "renderer failed".into(),
            })
            .unwrap();
        assert_eq!(aborted.stage, "failed");
        assert_eq!(aborted.received_frames, 2);
        assert!(!output.exists());
        let recovered = dir.join(format!("recovered-{codec}.{}", format.extension()));
        let binaries = backend.discovery.binaries.as_ref().unwrap();
        let mut args = process::strings(&["-v", "error", "-nostdin", "-xerror", "-threads", "2"]);
        if codec != "vp9" {
            args.extend(process::strings(&["-r", "20"]));
        }
        args.extend([
            "-f".into(),
            if codec == "vp9" { "ivf" } else { codec }.into(),
            "-i".into(),
            source.to_string_lossy().into_owned(),
            "-map".into(),
            "0:v:0".into(),
            "-an".into(),
            "-c:v".into(),
            "copy".into(),
        ]);
        if codec != "vp9" {
            args.extend(process::strings(&[
                "-bsf:v",
                "setts=pts=N:dts=N:duration=1:time_base=1/20",
            ]));
        }
        if codec == "hevc" {
            args.extend(process::strings(&["-tag:v", "hvc1"]));
        }
        args.extend([
            "-progress".into(),
            "pipe:1".into(),
            recovered.to_string_lossy().into_owned(),
        ]);
        process::run(
            &binaries.ffmpeg,
            &args,
            None,
            &Control::new(),
            30,
            std::slice::from_ref(&recovered),
        )
        .unwrap();
        let verified = crate::verify::inspect(
            binaries,
            &recovered,
            crate::verify::ExpectedOutput {
                format,
                width: 64,
                height: 64,
                frame_count: 2,
                duration: 0.1,
                rate: 20.0,
            },
            &Control::new(),
        )
        .unwrap();
        assert_eq!(verified["decoded_frames"], 2);
        assert_eq!(backend.status(&job.job_id).unwrap().stage, "failed"); // Manual recovery did not publish the job.
        fs::remove_file(
            std::env::temp_dir()
                .join("rav-media-export-v1")
                .join(&job.job_id),
        )
        .unwrap();
    }
    fs::remove_dir_all(dir).unwrap();
}
