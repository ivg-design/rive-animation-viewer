//! ProRes and png-sequence/jpg-sequence unit coverage, split out of unit.rs to stay
//! under the architecture line budget.
use crate::unit::{request, root};
use crate::{encode, spool, types::*};
use std::{fs, path::PathBuf};

#[test]
fn prores_codec_args_map_alpha_and_quality_to_pix_fmt_and_qscale_endpoints() {
    let alpha = encode::codec_args(Format::Prores, 100, true);
    assert!(alpha.windows(2).any(|w| w == ["-profile:v", "4"]));
    assert!(alpha.windows(2).any(|w| w == ["-pix_fmt", "yuva444p10le"]));
    assert!(alpha.windows(2).any(|w| w == ["-vendor", "apl0"]));
    assert!(alpha.windows(2).any(|w| w == ["-qscale:v", "0"]));

    let opaque = encode::codec_args(Format::Prores, 1, false);
    assert!(opaque.windows(2).any(|w| w == ["-pix_fmt", "yuv444p10le"]));
    assert!(opaque.windows(2).any(|w| w == ["-qscale:v", "32"]));
    assert!(!opaque.iter().any(|a| a == "-movflags"));
}
#[test]
fn sequence_formats_name_frames_and_build_pix_fmt_quality_args() {
    assert_eq!(
        encode::sequence_frame_name(Format::PngSequence, 0),
        "frame_000000.png"
    );
    assert_eq!(
        encode::sequence_frame_name(Format::PngSequence, 41),
        "frame_000041.png"
    );
    assert_eq!(
        encode::sequence_frame_name(Format::JpgSequence, 999_999),
        "frame_999999.jpg"
    );
    let png = encode::codec_args(Format::PngSequence, 80, true);
    assert!(png.windows(2).any(|w| w == ["-pix_fmt", "rgba"]));
    assert!(png.iter().any(|a| a == "image2"));
    let png_opaque = encode::codec_args(Format::PngSequence, 80, false);
    assert!(png_opaque.windows(2).any(|w| w == ["-pix_fmt", "rgb24"]));
    let jpg = encode::codec_args(Format::JpgSequence, 100, false);
    assert!(jpg.windows(2).any(|w| w == ["-pix_fmt", "yuvj420p"]));
    assert!(jpg.windows(2).any(|w| w == ["-q:v", "2"]));
    assert!(!Format::JpgSequence.alpha() && !Format::H264.alpha());
    assert!(Format::PngSequence.alpha() && Format::Apng.alpha() && Format::Gif.alpha());
    assert!(Format::Prores.alpha() && Format::Webm.alpha() && Format::Png.alpha());
    assert!(Format::PngSequence.is_directory() && Format::JpgSequence.is_directory());
    assert!(!Format::Prores.is_directory() && !Format::Png.is_directory());
}
#[test]
fn jpg_sequence_alpha_is_rejected_like_still_jpg() {
    let mut r = request(PathBuf::from("/tmp/shots"), Format::JpgSequence);
    r.alpha = true;
    assert!(r.validate().is_err());
    r.alpha = false;
    assert!(r.validate().is_ok());
}
#[test]
fn sequence_output_paths_skip_extension_validation() {
    let dir = root();
    let id = uuid::Uuid::new_v4().to_string();
    // No extension at all is accepted for a directory-shaped output.
    let item = spool::Spool::new(
        &id,
        dir.join("shots").to_str().unwrap(),
        Format::PngSequence,
        false,
    )
    .unwrap();
    item.clean().unwrap();
    // A path that happens to look like it has an extension is fine too; it is a directory name.
    let item = spool::Spool::new(
        &uuid::Uuid::new_v4().to_string(),
        dir.join("shots.frames").to_str().unwrap(),
        Format::JpgSequence,
        false,
    )
    .unwrap();
    item.clean().unwrap();
    fs::remove_dir_all(dir).unwrap();
}
fn write_frames(dir: &std::path::Path, names: &[&str]) {
    fs::create_dir_all(dir).unwrap();
    for (index, name) in names.iter().enumerate() {
        fs::write(dir.join(name), format!("frame-{index}").as_bytes()).unwrap();
    }
}
#[test]
fn sequence_publish_moves_the_whole_directory_when_destination_is_new() {
    let dir = root();
    let id = uuid::Uuid::new_v4().to_string();
    let target = dir.join("out");
    let spool = spool::Spool::new(&id, target.to_str().unwrap(), Format::PngSequence, false).unwrap();
    let candidate = spool.dir.join("candidate-frames");
    write_frames(&candidate, &["frame_000000.png", "frame_000001.png"]);
    // Destination does not exist: publish succeeds via a whole-directory move.
    let size = spool.publish_directory(&candidate, false).unwrap();
    assert_eq!(size, "frame-0".len() as u64 + "frame-1".len() as u64);
    assert_eq!(
        fs::read(target.join("frame_000000.png")).unwrap(),
        b"frame-0"
    );
    assert!(!candidate.exists());
    spool.clean().unwrap();
    fs::remove_dir_all(&dir).unwrap();
}
#[test]
fn sequence_publish_accepts_an_existing_empty_destination_directory() {
    let dir = root();
    let target = dir.join("out");
    fs::create_dir(&target).unwrap();
    let spool = spool::Spool::new(
        &uuid::Uuid::new_v4().to_string(),
        target.to_str().unwrap(),
        Format::PngSequence,
        false,
    )
    .unwrap();
    let candidate = spool.dir.join("candidate-frames");
    write_frames(&candidate, &["frame_000000.png"]);
    spool.publish_directory(&candidate, false).unwrap();
    assert!(target.join("frame_000000.png").exists());
    spool.clean().unwrap();
    fs::remove_dir_all(&dir).unwrap();
}
#[test]
fn sequence_publish_fails_closed_on_a_non_empty_destination_without_overwrite() {
    let dir = root();
    let target = dir.join("out");
    // Begin refuses a non-empty destination before any capture runs.
    write_frames(&target, &["frame_000000.png"]);
    let refused = spool::Spool::new(
        &uuid::Uuid::new_v4().to_string(),
        target.to_str().unwrap(),
        Format::PngSequence,
        false,
    );
    assert!(matches!(refused, Err(error) if error.contains("not empty")));
    // A racer that fills the directory after begin is still refused at publish.
    let racer = target.join("frame_000000.png");
    fs::remove_file(&racer).unwrap();
    let spool = spool::Spool::new(
        &uuid::Uuid::new_v4().to_string(),
        target.to_str().unwrap(),
        Format::PngSequence,
        false,
    )
    .unwrap();
    write_frames(&target, &["frame_000000.png"]);
    let candidate = spool.dir.join("candidate-frames");
    write_frames(&candidate, &["frame_000000.png"]);
    assert!(spool.publish_directory(&candidate, false).is_err());
    // Nothing was touched: the racer's original frame content survives untouched.
    assert_eq!(fs::read(target.join("frame_000000.png")).unwrap(), b"frame-0");
    spool.clean().unwrap();
    fs::remove_dir_all(&dir).unwrap();
}
#[test]
fn sequence_publish_overwrite_removes_only_matching_frames_and_keeps_unrelated_files() {
    let dir = root();
    let target = dir.join("out");
    write_frames(&target, &["frame_000000.png", "frame_000001.png"]);
    fs::write(target.join("notes.txt"), b"keep me").unwrap();
    #[cfg(unix)]
    {
        // A symlinked frame name must never be followed for deletion.
        std::os::unix::fs::symlink(dir.join("notes.txt"), target.join("frame_000002.png")).unwrap();
    }
    let spool = spool::Spool::new(
        &uuid::Uuid::new_v4().to_string(),
        target.to_str().unwrap(),
        Format::PngSequence,
        true,
    )
    .unwrap();
    let candidate = spool.dir.join("candidate-frames");
    write_frames(&candidate, &["frame_000000.png"]);
    spool.publish_directory(&candidate, true).unwrap();
    // Old matching frames are gone, replaced by the new candidate's single frame.
    assert_eq!(
        fs::read(target.join("frame_000000.png")).unwrap(),
        b"frame-0"
    );
    assert!(!target.join("frame_000001.png").exists());
    // The unrelated file, and a dangling symlink merely named like a frame, both survive.
    assert_eq!(fs::read(target.join("notes.txt")).unwrap(), b"keep me");
    #[cfg(unix)]
    assert!(fs::symlink_metadata(target.join("frame_000002.png")).is_ok());
    spool.clean().unwrap();
    fs::remove_dir_all(&dir).unwrap();
}


#[test]
fn output_state_is_read_only_for_missing_empty_and_occupied_directories() {
    use spool::output_state::{inspect, OutputState, OutputStateRequest};
    let dir = root();
    let output = dir.join("frames");
    let inspect_path = || inspect(OutputStateRequest {
        output_path: output.to_str().unwrap().into(),
        format: Format::PngSequence,
    }).unwrap();
    assert_eq!(inspect_path(), OutputState { exists: false, empty: true, is_dir: false });
    assert!(!output.exists()); // No output or spool may be created by a preflight.
    fs::create_dir(&output).unwrap();
    assert_eq!(inspect_path(), OutputState { exists: true, empty: true, is_dir: true });
    fs::write(output.join("notes.txt"), b"keep").unwrap();
    assert_eq!(inspect_path(), OutputState { exists: true, empty: false, is_dir: true });
    assert_eq!(fs::read(output.join("notes.txt")).unwrap(), b"keep");
    fs::remove_file(output.join("notes.txt")).unwrap();
    fs::create_dir(output.join("subfolder")).unwrap();
    assert!(!inspect_path().empty); // A subdirectory also counts as content.
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn output_state_rejects_invalid_requests_and_reports_regular_files() {
    use spool::output_state::{inspect, OutputState, OutputStateRequest};
    for path in ["", "/", "relative/frames", "/tmp/bad\0path"] {
        assert!(inspect(OutputStateRequest { output_path: path.into(), format: Format::PngSequence }).is_err());
    }
    assert!(inspect(OutputStateRequest { output_path: "x".repeat(4097), format: Format::PngSequence }).is_err());
    let dir = root();
    let file = dir.join("frames");
    fs::write(&file, b"not a directory").unwrap();
    let state = inspect(OutputStateRequest { output_path: file.to_str().unwrap().into(), format: Format::JpgSequence }).unwrap();
    assert_eq!(state, OutputState { exists: true, empty: false, is_dir: false });
    assert!(inspect(OutputStateRequest { output_path: file.to_str().unwrap().into(), format: Format::Png }).is_err());
    assert!(serde_json::from_value::<OutputStateRequest>(serde_json::json!({
        "output_path": file, "format": "png-sequence", "overwrite": true,
    })).is_err());
    assert_eq!(serde_json::to_value(state).unwrap(), serde_json::json!({ "exists": true, "empty": false, "is_dir": false }));
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn output_state_never_follows_destination_symlinks_even_when_dangling() {
    use spool::output_state::{inspect, OutputStateRequest};
    let dir = root();
    let target = dir.join("target");
    let link = dir.join("frames");
    fs::create_dir(&target).unwrap();
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let inspect_link = || inspect(OutputStateRequest {
        output_path: link.to_str().unwrap().into(), format: Format::PngSequence,
    }).unwrap();
    let state = inspect_link();
    assert!(state.exists && !state.is_dir && !state.empty);
    let trailing = inspect(OutputStateRequest {
        output_path: format!("{}/", link.display()),
        format: Format::PngSequence,
    }).unwrap();
    assert!(trailing.exists && !trailing.is_dir && !trailing.empty);
    fs::remove_dir(&target).unwrap();
    let state = inspect_link();
    assert!(state.exists && !state.is_dir && !state.empty);
    fs::remove_dir_all(dir).unwrap();
}
