use super::*;

#[test]
#[ignore = "requires RAV_TEST_BROWSER_PNG from the desktop WKWebView capture"]
fn desktop_browser_png() {
    let path =
        std::env::var("RAV_TEST_BROWSER_PNG").expect("Set path to an actual desktop canvas PNG");
    let bytes = fs::read(path).unwrap();
    let reader = png::Decoder::new(bytes.as_slice()).read_info().unwrap();
    let (width, height) = (reader.info().width, reader.info().height);
    let sanitized = crate::spool::sanitize_png(&bytes, width, height).unwrap();
    assert!(!sanitized.windows(4).any(|window| window == b"eXIf"));
    let dir = root();
    let output = dir.join("webkit.png");
    let backend = Backend::new(discovery::discover(Some(&config(false)))).unwrap();
    let mut r = request(output.clone(), Format::Png);
    r.width = width;
    r.height = height;
    r.alpha = true;
    let job = backend.begin(r).unwrap();
    backend
        .frame(FrameRequest {
            job_id: job.job_id.clone(),
            frame_index: 0,
            png_base64: STANDARD.encode(bytes),
        })
        .unwrap();
    backend
        .finish(FinishRequest {
            job_id: job.job_id.clone(),
            frame_count: 1,
        })
        .unwrap();
    let completed = wait(&backend, &job.job_id);
    assert_eq!(completed.state, "completed", "{completed:?}");
    fs::write(
        dir.join("receipt.json"),
        serde_json::to_vec_pretty(&completed).unwrap(),
    )
    .unwrap();
    println!(
        "WEBKIT_ARTIFACT={} SIZE={}x{}",
        output.display(),
        width,
        height
    );
}

#[test]
#[ignore = "requires real FFmpeg/ffprobe"]
fn verification_rejects_wrong_count_and_truncated_media() {
    let dir = root();
    let backend = Backend::new(discovery::discover(Some(&config(false)))).unwrap();
    let path = dir.join("verification.mp4");
    export(&backend, request(path.clone(), Format::H264), 10);
    let binaries = backend.discovery.binaries.as_ref().unwrap();
    let inspect = |path: &Path, count| {
        crate::verify::inspect(
            binaries,
            path,
            crate::verify::ExpectedOutput {
                format: Format::H264,
                width: 64,
                height: 64,
                frame_count: count,
                duration: 0.5,
                rate: 20.0,
            },
            &Control::new(),
        )
    };
    assert_eq!(inspect(&path, 10).unwrap()["decoded_frames"], 10);
    assert!(inspect(&path, 9)
        .unwrap_err()
        .contains("Decoded frame count 10, expected 9"));
    let bytes = fs::read(&path).unwrap();
    let mdat = bytes
        .windows(4)
        .position(|window| window == b"mdat")
        .unwrap()
        + 4;
    let truncated = dir.join("truncated.mp4");
    fs::write(&truncated, &bytes[..mdat + (bytes.len() - mdat) / 2]).unwrap();
    let mut args = process::strings(&[
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height:format=duration",
        "-of",
        "json",
    ]);
    args.push(truncated.to_string_lossy().into_owned());
    let raw = process::run(&binaries.ffprobe, &args, None, &Control::new(), 30, &[]).unwrap();
    let header: serde_json::Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(header["streams"][0]["codec_name"], "h264");
    assert_eq!(header["streams"][0]["width"], 64);
    assert_eq!(header["streams"][0]["height"], 64);
    assert_eq!(
        header["format"]["duration"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap(),
        0.5
    );
    assert!(
        inspect(&truncated, 10).is_err(),
        "Valid headers must not hide truncated media"
    );
    fs::remove_dir_all(dir).unwrap();
}
