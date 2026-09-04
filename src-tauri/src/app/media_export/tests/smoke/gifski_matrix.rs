use super::*;

#[test]
#[ignore = "requires RAV_TEST_GIFSKI pointing to a verification-only gifski"]
fn real_gifski_matrix() {
    let dir = root();
    let backend = Backend::new(discovery::discover(Some(&config(true)))).unwrap();
    assert_eq!(
        backend.capabilities()["gif"]["gifski_available"],
        true,
        "{}",
        backend.capabilities()
    );
    println!("GIFSKI_ARTIFACT_DIRECTORY={}", dir.display());
    let mut jobs = Vec::new();
    for (name, alpha, count, policy) in [
        ("alpha", true, 10, None),
        ("matte", false, 10, None),
        ("single", true, 1, None),
        ("target", true, 11, Some("quality_fps_scale")),
        ("matte-target", false, 11, Some("quality_fps_scale")),
        ("quality", false, 10, Some("quality_only")),
    ] {
        let mut r = request(dir.join(format!("{name}.gif")), Format::Gif);
        r.alpha = alpha;
        r.background = "#183050".into();
        r.gif = Some(GifOptions {
            encoder: "gifski".into(),
            motion_quality: Some(75),
            lossy_quality: Some(70),
            max_bytes: policy.map(|_| 1),
            size_policy: policy.map(str::to_owned),
            ..Default::default()
        });
        let job = export(&backend, r, count);
        if policy.is_some() {
            assert_eq!(
                job.resolved_settings["attempts"].as_array().unwrap().len(),
                5
            );
        }
        let raw = decode(
            &backend,
            Path::new(job.output_path.as_ref().unwrap()),
            Format::Gif,
        );
        assert!(!raw.is_empty());
        assert_eq!(raw[3], if alpha { 0 } else { 255 });
        jobs.push(job);
    }
    fs::write(
        dir.join("receipts.json"),
        serde_json::to_vec_pretty(&json!({"capabilities":backend.capabilities(),"jobs":jobs}))
            .unwrap(),
    )
    .unwrap();
}
