use super::*;

#[test]
#[ignore = "requires real FFmpeg/ffprobe and optional test-only gifski"]
fn real_encoder_matrix() {
    let dir = root();
    let backend = Backend::new(discovery::discover(Some(&config(false)))).unwrap();
    println!("ARTIFACT_DIRECTORY={}", dir.display());
    println!("CAPABILITIES={}", backend.capabilities());
    for format in backend.capabilities()["formats"].as_array().unwrap() {
        assert_eq!(format["available"], true, "Unavailable: {format}");
    }
    let mut receipts = Vec::new();
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
        let name = serde_json::to_value(format)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned();
        let path = dir.join(format!("{name}.{}", format.extension()));
        let mut r = request(path.clone(), format);
        r.alpha = format.alpha();
        r.background = "#183050".into();
        r.max_frames = Some(36_000);
        let count = if format.animated() { 10 } else { 1 };
        let job = export(&backend, r, count);
        let raw = decode(&backend, &path, format);
        assert_eq!(raw.len() % (64 * 64 * 4), 0);
        assert!(!raw.is_empty());
        let first = &raw[..64 * 64 * 4];
        if format.alpha() {
            assert!(first[3] < 10, "Missing transparency: {format:?}");
            if format != Format::Gif {
                assert!(
                    (first[24 * 4 + 3] as i32 - 128).abs() < 12,
                    "Lost fractional alpha: {format:?}"
                );
            }
        } else {
            for (i, want) in [24, 48, 80].iter().enumerate() {
                assert!(
                    (first[i] as i32 - want).abs() < 16,
                    "Incorrect matte {format:?}: {:?}",
                    &first[..4]
                );
            }
        }
        if format.animated() && format != Format::Gif {
            assert_eq!(raw.len() / (64 * 64 * 4), 10);
            for (index, color) in [
                (0, [220, 60, 120]),
                (2, [220, 60, 120]),
                (3, [40, 210, 80]),
                (7, [40, 210, 80]),
                (8, [60, 80, 220]),
                (9, [60, 80, 220]),
            ] {
                let offset = index * 64 * 64 * 4 + 48 * 4;
                for c in 0..3 {
                    assert!(
                        (raw[offset + c] as i32 - color[c]).abs() < 25,
                        "Held-frame content mismatch {format:?}, index {index}: {:?}",
                        &raw[offset..offset + 4]
                    );
                }
            }
        }
        assert_eq!(job.frame_count, Some(count));
        assert!(!dir.join(format!(".rav-media-{}", job.job_id)).exists());
        receipts.push(job);
    }
    let mut rational = request(dir.join("rational.mp4"), Format::H264);
    rational.fps = Rate {
        numerator: 30_000,
        denominator: 1001,
    };
    receipts.push(export(&backend, rational, 10));
    for format in [
        Format::Webm,
        Format::Apng,
        Format::Gif,
        Format::Png,
        Format::Webp,
    ] {
        let name = serde_json::to_value(format)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned();
        let path = dir.join(format!("matte-{name}.{}", format.extension()));
        let mut r = request(path.clone(), format);
        r.background = "#183050".into();
        r.quality = 100;
        let job = export(&backend, r, if format.animated() { 10 } else { 1 });
        let raw = decode(&backend, &path, format);
        for (i, want) in [24, 48, 80].iter().enumerate() {
            assert!((raw[i] as i32 - want).abs() < 16, "Matte {format:?}");
        }
        assert_eq!(raw[3], 255);
        receipts.push(job);
    }
    for format in [Format::Gif, Format::Apng] {
        let mut r = request(dir.join(format!("single.{}", format.extension())), format);
        r.alpha = true;
        receipts.push(export(&backend, r, 1));
    }
    for policy in ["quality_only", "quality_fps_scale"] {
        let mut r = request(dir.join(format!("target-{policy}.gif")), Format::Gif);
        r.alpha = policy == "quality_only";
        r.background = "#183050".into();
        r.gif = Some(GifOptions {
            encoder: "ffmpeg".into(),
            max_bytes: Some(1),
            size_policy: Some(policy.into()),
            ..Default::default()
        });
        let job = export(&backend, r, 11);
        assert_eq!(
            job.resolved_settings["attempts"].as_array().unwrap().len(),
            5
        );
        assert_eq!(job.resolved_settings["target_met"], false);
        receipts.push(job);
    }
    let path = dir.join("cancel.webm");
    let job = backend.begin(request(path.clone(), Format::Webm)).unwrap();
    backend
        .frame(FrameRequest {
            job_id: job.job_id.clone(),
            frame_index: 0,
            png_base64: png([220, 60, 120]),
        })
        .unwrap();
    backend
        .finish(FinishRequest {
            job_id: job.job_id.clone(),
            frame_count: 1000,
        })
        .unwrap();
    let started = Instant::now();
    while !dir
        .join(format!(".rav-media-{}/candidate.webm", job.job_id))
        .exists()
    {
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "Encoder did not start"
        );
        assert_eq!(backend.status(&job.job_id).unwrap().state, "encoding");
        thread::sleep(Duration::from_millis(10));
    }
    backend.cancel(&job.job_id).unwrap();
    let cancelled = wait(&backend, &job.job_id);
    assert_eq!(cancelled.state, "cancelled");
    assert!(!path.exists());
    assert!(!dir.join(format!(".rav-media-{}", job.job_id)).exists());
    fs::write(
        dir.join("receipts.json"),
        serde_json::to_vec_pretty(
            &json!({"capabilities":backend.capabilities(),"jobs":receipts,"cancel":cancelled}),
        )
        .unwrap(),
    )
    .unwrap();
}
