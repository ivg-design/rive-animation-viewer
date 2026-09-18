//! Sequence formats (`png-sequence`/`jpg-sequence`) write one image per frame into a
//! directory via ffmpeg's image2 muxer, rather than a single container file. The PNG
//! capture spool feeds ffmpeg exactly as the ordinary path does; only the output side
//! differs (a numbered directory pattern instead of one file).
use super::super::{
    process::{self, Control},
    spool::{self, Spool},
    types::*,
};
use super::{codec_args, filter, input, FfmpegPlan};
use std::path::{Path, PathBuf};

/// Frame file name for a sequence format, e.g. "frame_000042.png".
pub fn sequence_frame_name(format: Format, index: u32) -> String {
    let ext = if format == Format::JpgSequence {
        "jpg"
    } else {
        "png"
    };
    format!("frame_{index:06}.{ext}")
}
fn sequence_pattern(dir: &Path, format: Format) -> PathBuf {
    let ext = if format == Format::JpgSequence {
        "jpg"
    } else {
        "png"
    };
    dir.join(format!("frame_%06d.{ext}"))
}
fn ffmpeg_sequence(
    binaries: &Binaries,
    plan: FfmpegPlan<'_>,
    control: &Control,
) -> Result<PathBuf> {
    let FfmpegPlan {
        request,
        spool,
        sequence,
        count,
        rate,
        width,
        height,
        quality,
    } = plan;
    let output_dir = spool.dir.join("candidate-frames");
    std::fs::create_dir(&output_dir).map_err(io)?;
    let pattern = sequence_pattern(&output_dir, request.format);
    let mut args = input(sequence, rate);
    args.extend([
        "-filter_complex".into(),
        filter(request, width, height, "", rate),
        "-map".into(),
        "[out]".into(),
        "-frames:v".into(),
        count.to_string(),
        "-fps_mode".into(),
        "passthrough".into(),
    ]);
    args.extend(codec_args(request.format, quality, request.alpha));
    args.extend([
        "-start_number".into(),
        "0".into(),
        "-progress".into(),
        "pipe:1".into(),
        pattern.to_string_lossy().into_owned(),
    ]);
    process::run(
        &binaries.ffmpeg,
        &args,
        None,
        control,
        600,
        &[output_dir.clone(), spool.dir.clone()],
    )?;
    Ok(output_dir)
}
pub fn sequence(
    binaries: &Binaries,
    request: &BeginRequest,
    spool: &Spool,
    indices: &[u32],
    count: u32,
    control: &Control,
) -> Result<(PathBuf, serde_json::Value)> {
    let src = spool::capture_sequence(spool, indices, count, count, control)?;
    let output_dir = ffmpeg_sequence(
        binaries,
        FfmpegPlan {
            request,
            spool,
            sequence: &src,
            count,
            rate: request.fps,
            width: request.width,
            height: request.height,
            quality: request.quality,
        },
        control,
    )?;
    Ok((
        output_dir,
        serde_json::json!({ "encoder": "ffmpeg", "codec": request.format.codec(),
        "width": request.width, "height": request.height, "fps": request.fps,
        "frame_count": count, "duration_seconds": count as f64 / request.fps.value(),
        "quality": request.quality }),
    ))
}
