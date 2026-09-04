use super::{
    local_binary, manifest, selected_config, validation, DEV_IDENTIFIER, PRODUCTION_IDENTIFIER,
};
use serde_json::{json, Value};
use std::{
    cell::Cell,
    fs,
    path::{Path, PathBuf},
};

struct FixtureIntegrity {
    file: String,
    sha256: String,
    size_bytes: u64,
}

fn write(path: &Path, bytes: &[u8], executable: bool) -> FixtureIntegrity {
    fs::create_dir_all(path.parent().expect("fixture parent")).unwrap();
    fs::write(path, bytes).unwrap();
    #[cfg(unix)]
    if executable {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let (sha256, size_bytes) = validation::hash_file(path, validation::RESOURCE_LIMIT).unwrap();
    FixtureIntegrity {
        file: path.file_name().unwrap().to_string_lossy().into_owned(),
        sha256,
        size_bytes,
    }
}

fn fixture() -> (PathBuf, Value) {
    let root = std::env::temp_dir().join(format!("rav-encoder-manifest-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("licenses")).unwrap();
    fs::create_dir_all(root.join("provenance")).unwrap();
    let inventory = write(
        &root.join("inventory.json"),
        b"{\"approved\":true}\n",
        false,
    );
    let notice = write(
        &root.join("licenses/NOTICE.txt"),
        b"fixture notice\n",
        false,
    );
    let attestation = write(
        &root.join("provenance/build.json"),
        b"{\"fixture\":true}\n",
        false,
    );
    let binary = write(&root.join("ffmpeg"), b"#!/bin/sh\nexit 0\n", true);
    let binary_two = write(&root.join("ffprobe"), b"#!/bin/sh\nexit 0\n", true);
    let entry = |id: &str, binary: &FixtureIntegrity| {
        json!({
            "id": id,
            "file": binary.file,
            "sha256": binary.sha256,
            "size_bytes": binary.size_bytes,
            "version": "test-1.0",
            "source": {
                "kind": "self_built_from_upstream",
                "artifact_url": "https://downloads.example.invalid/artifact.tar.xz",
                "artifact_sha256": "1".repeat(64),
                "source_code_url": "https://source.example.invalid/source.tar.xz",
                "source_code_sha256": "2".repeat(64)
            },
            "provenance_file": {
                "file": "provenance/build.json",
                "sha256": attestation.sha256,
                "size_bytes": attestation.size_bytes
            },
            "license": {
                "spdx": "MIT",
                "notice_files": [{
                    "file": "licenses/NOTICE.txt",
                    "sha256": notice.sha256,
                    "size_bytes": notice.size_bytes
                }],
                "redistribution_basis": "Synthetic fixture owned by the test suite",
                "review_reference": "TEST-ONLY-REVIEW"
            }
        })
    };
    let manifest = json!({
        "schema_version": 1,
        "distribution": {
            "id": "test-approved-encoders",
            "target": validation::runtime_target(),
            "provenance_summary": "Synthetic test resources with explicit fixture ownership",
            "inventory_file": "inventory.json",
            "inventory_sha256": inventory.sha256,
            "inventory_size_bytes": inventory.size_bytes,
            "approval": {
                "redistribution_approved": true,
                "approved_by": "RAV automated fixture owner",
                "approved_at": "2026-09-03",
                "review_reference": "TEST-ONLY-DISTRIBUTION-REVIEW",
                "signing_required": true
            }
        },
        "binaries": [entry("ffmpeg", &binary), entry("ffprobe", &binary_two)]
    });
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    (root, manifest)
}

#[test]
fn approved_manifest_loads_with_runtime_integrity_metadata() {
    let (root, _) = fixture();
    let config = manifest::load(&root).unwrap();
    let distribution = config.distribution.unwrap();
    assert_eq!(distribution.target, validation::runtime_target());
    assert_eq!(distribution.components.len(), 2);
    assert_eq!(
        config.ffmpeg.size_bytes,
        fs::metadata(&config.ffmpeg.path).unwrap().len()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn manifest_rejects_unapproved_wrong_target_and_tampered_resources() {
    let (root, mut value) = fixture();
    value["distribution"]["approval"]["redistribution_approved"] = json!(false);
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    assert!(manifest::load(&root)
        .err()
        .unwrap()
        .contains("explicitly approved"));

    value["distribution"]["approval"]["redistribution_approved"] = json!(true);
    value["distribution"]["target"] = json!("wrong-target");
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    assert!(manifest::load(&root)
        .err()
        .unwrap()
        .contains("does not match runtime"));

    value["distribution"]["target"] = json!(validation::runtime_target());
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    fs::write(root.join("licenses/NOTICE.txt"), b"tampered\n").unwrap();
    assert!(manifest::load(&root)
        .err()
        .unwrap()
        .contains("integrity mismatch"));
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn manifest_rejects_resource_symlinks() {
    let (root, _) = fixture();
    let target = root.join("real-ffmpeg");
    fs::rename(root.join("ffmpeg"), &target).unwrap();
    std::os::unix::fs::symlink(&target, root.join("ffmpeg")).unwrap();
    assert!(manifest::load(&root).err().unwrap().contains("symlink"));
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn development_binary_may_resolve_an_installed_tool_symlink() {
    let root = std::env::temp_dir().join(format!("rav-dev-encoder-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let executable = root.join("ffmpeg-real");
    write(&executable, b"#!/bin/sh\nexit 0\n", true);
    let link = root.join("ffmpeg");
    std::os::unix::fs::symlink(&executable, &link).unwrap();
    let trusted = local_binary(link).unwrap();
    assert_eq!(trusted.path, executable.canonicalize().unwrap());
    assert_eq!(trusted.size_bytes, fs::metadata(executable).unwrap().len());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn development_prefers_an_approved_bundled_manifest() {
    let (root, _) = fixture();
    let fallback_called = Cell::new(false);
    let config = selected_config(DEV_IDENTIFIER, &root, || {
        fallback_called.set(true);
        Err("local fallback must not run".into())
    })
    .unwrap();
    assert!(!fallback_called.get());
    assert!(config.distribution.is_some());
    assert_eq!(
        config.provenance,
        "Synthetic test resources with explicit fixture ownership"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn development_falls_back_only_when_the_bundled_manifest_is_absent() {
    let root = std::env::temp_dir().join(format!("rav-dev-no-manifest-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let fallback_called = Cell::new(false);
    let error = selected_config(DEV_IDENTIFIER, &root, || {
        fallback_called.set(true);
        Err("local DEV fallback selected".into())
    })
    .err()
    .expect("absent manifest should select the local fallback");
    assert!(fallback_called.get());
    assert_eq!(error, "local DEV fallback selected");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn present_invalid_dev_manifest_fails_closed_without_local_fallback() {
    let root =
        std::env::temp_dir().join(format!("rav-dev-invalid-manifest-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("manifest.json"), b"not valid JSON\n").unwrap();
    let fallback_called = Cell::new(false);
    let result = selected_config(DEV_IDENTIFIER, &root, || {
        fallback_called.set(true);
        Err("local fallback must not run".into())
    });
    assert!(result.is_err());
    assert!(!fallback_called.get());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn production_is_bundled_only_and_other_identities_remain_disabled() {
    let root = std::env::temp_dir().join(format!("rav-identity-policy-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let fallback_called = Cell::new(false);
    assert!(selected_config(PRODUCTION_IDENTIFIER, &root, || {
        fallback_called.set(true);
        Err("local fallback must not run".into())
    })
    .is_err());
    assert!(!fallback_called.get());
    let disabled = selected_config("test.rav.unapproved", &root, || {
        fallback_called.set(true);
        Err("local fallback must not run".into())
    })
    .err()
    .expect("unapproved identities must be disabled");
    assert!(disabled.contains("disabled"));
    assert!(!fallback_called.get());
    fs::remove_dir_all(root).unwrap();
}
