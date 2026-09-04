use super::{
    process::{self, Control},
    spool::{self, Spool},
    types::*,
};
use std::path::{Path, PathBuf};

pub fn base() -> Vec<String> {
    process::strings(&[
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-max_alloc",
        "268435456",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
        "-threads",
        "2",
    ])
}
pub fn codec_args(format: Format, quality: u8, alpha: bool) -> Vec<String> {
    let mut args = process::strings(&["-an", "-c:v", format.codec(), "-threads", "2"]);
    let extra = match format {
        Format::H264 => vec![
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-preset".into(),
            "medium".into(),
            "-crf".into(),
            (35 - quality as u32 * 20 / 100).to_string(),
            "-movflags".into(),
            "+faststart".into(),
        ],
        Format::H265 => vec![
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-preset".into(),
            "medium".into(),
            "-crf".into(),
            (40 - quality as u32 * 22 / 100).to_string(),
            "-tag:v".into(),
            "hvc1".into(),
            "-x265-params".into(),
            "pools=1:frame-threads=1:rc-lookahead=8:log-level=error".into(),
            "-movflags".into(),
            "+faststart".into(),
        ],
        Format::Webm => vec![
            "-pix_fmt".into(),
            if alpha { "yuva420p" } else { "yuv420p" }.into(),
            "-b:v".into(),
            "0".into(),
            "-crf".into(),
            (50 - quality as u32 * 30 / 100).to_string(),
            "-deadline".into(),
            "good".into(),
            "-cpu-used".into(),
            "4".into(),
            "-lag-in-frames".into(),
            "0".into(),
            "-auto-alt-ref".into(),
            "0".into(),
        ],
        Format::Apng => process::strings(&["-pix_fmt", "rgba", "-plays", "0", "-f", "apng"]),
        Format::Png => process::strings(&[
            "-pix_fmt",
            if alpha { "rgba" } else { "rgb24" },
            "-update",
            "1",
            "-f",
            "image2",
        ]),
        Format::Jpg => vec![
            "-pix_fmt".into(),
            "yuvj444p".into(),
            "-q:v".into(),
            (31 - quality as u32 * 29 / 100).to_string(),
            "-update".into(),
            "1".into(),
            "-f".into(),
            "image2".into(),
        ],
        Format::Webp => vec![
            "-quality".into(),
            quality.to_string(),
            "-lossless".into(),
            u8::from(quality == 100).to_string(),
            "-f".into(),
            "webp".into(),
        ],
        Format::Gif => process::strings(&["-gifflags", "+transdiff", "-f", "gif"]),
    };
    args.extend(extra);
    args
}
pub fn input(dir: &Path, fps: Rate) -> Vec<String> {
    let mut args = base();
    args.extend([
        "-framerate".into(),
        fps.text(),
        "-start_number".into(),
        "0".into(),
        "-f".into(),
        "image2".into(),
        "-c:v".into(),
        "png".into(),
        "-i".into(),
        format!("{}/%06d.png", dir.to_string_lossy().replace('%', "%%")),
    ]);
    args
}
pub fn filter(request: &BeginRequest, width: u32, height: u32, tail: &str, rate: Rate) -> String {
    let scale = format!("scale={width}:{height}:flags=lanczos,setsar=1{tail}");
    if request.alpha {
        format!("[0:v]format=rgba,{scale}[out]")
    } else {
        format!(
            "color=c=0x{}:s={}x{}:r={}[bg];[0:v]format=rgba[fg];\
        [bg][fg]overlay=shortest=1:format=auto,format=rgb24,{scale}[out]",
            &request.background[1..],
            request.width,
            request.height,
            rate.text()
        )
    }
}
pub struct FfmpegPlan<'a> {
    pub request: &'a BeginRequest,
    pub spool: &'a Spool,
    pub sequence: &'a Path,
    pub count: u32,
    pub rate: Rate,
    pub width: u32,
    pub height: u32,
    pub quality: u8,
}

pub fn ffmpeg(binaries: &Binaries, plan: FfmpegPlan<'_>, control: &Control) -> Result<PathBuf> {
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
    let output = spool
        .dir
        .join(format!("candidate.{}", request.format.extension()));
    let mut args = input(sequence, rate);
    if request.format == Format::Gif {
        let palette = spool.dir.join("palette.png");
        let colors = 32 + (quality as u32 * 224 / 100);
        args.extend([
            "-filter_complex".into(),
            filter(
                request,
                width,
                height,
                &format!(
                    ",palettegen=max_colors={colors}:reserve_transparent={}",
                    u8::from(request.alpha)
                ),
                rate,
            ),
            "-map".into(),
            "[out]".into(),
            "-frames:v".into(),
            "1".into(),
        ]);
        args.extend(codec_args(Format::Png, 100, true));
        args.extend([
            "-progress".into(),
            "pipe:1".into(),
            palette.to_string_lossy().into_owned(),
        ]);
        process::run(
            &binaries.ffmpeg,
            &args,
            None,
            control,
            600,
            &[palette.clone(), spool.dir.clone()],
        )?;
        args = input(sequence, rate);
        args.extend([
            "-i".into(),
            palette.to_string_lossy().into_owned(),
            "-filter_complex".into(),
            format!(
                "{};[out][1:v]paletteuse=dither=sierra2_4a:alpha_threshold=128[gif]",
                filter(request, width, height, "", rate)
            ),
            "-map".into(),
            "[gif]".into(),
            "-loop".into(),
            request.gif.clone().unwrap_or_default().repeat.to_string(),
        ]);
    } else {
        args.extend([
            "-filter_complex".into(),
            filter(request, width, height, "", rate),
            "-map".into(),
            "[out]".into(),
        ]);
    }
    args.extend([
        "-frames:v".into(),
        count.to_string(),
        "-fps_mode".into(),
        "passthrough".into(),
    ]);
    args.extend(codec_args(request.format, quality, request.alpha));
    args.extend([
        "-progress".into(),
        "pipe:1".into(),
        output.to_string_lossy().into_owned(),
    ]);
    process::run(
        &binaries.ffmpeg,
        &args,
        None,
        control,
        600,
        &[output.clone(), spool.dir.clone()],
    )?;
    if request.format == Format::Apng && count == 1 {
        single_apng(&output, rate)?;
    }
    Ok(output)
}
fn single_apng(output: &Path, rate: Rate) -> Result<()> {
    // FFmpeg deliberately emits a plain PNG for a single frame. Preserve its converted pixels
    // while explicitly writing acTL/fcTL and the requested frame delay using the PNG encoder.
    let mut reader = png::Decoder::new_with_limits(
        std::fs::File::open(output).map_err(io)?,
        png::Limits {
            bytes: 64 * 1024 * 1024,
        },
    )
    .read_info()
    .map_err(io)?;
    let info = reader.info();
    let (width, height, color) = (info.width, info.height, info.color_type);
    if reader.output_buffer_size() as u64 > MAX_PIXELS * 4 {
        return Err("APNG still exceeds pixel bound".into());
    }
    let mut pixels = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut pixels).map_err(io)?;
    reader.finish().map_err(io)?;
    drop(reader);
    let mut encoder = png::Encoder::new(std::fs::File::create(output).map_err(io)?, width, height);
    encoder.set_color(color);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_animated(1, 0).map_err(io)?;
    let delay = if rate.numerator <= u16::MAX as u32 && rate.denominator <= u16::MAX as u32 {
        (rate.denominator as u16, rate.numerator as u16)
    } else {
        ((60_000.0 / rate.value()).round().max(1.0) as u16, 60_000)
    };
    encoder.set_frame_delay(delay.0, delay.1).map_err(io)?;
    let mut writer = encoder.write_header().map_err(io)?;
    writer.write_image_data(&pixels).map_err(io)?;
    writer.finish().map_err(io)
}
pub fn ordinary(
    binaries: &Binaries,
    request: &BeginRequest,
    spool: &Spool,
    indices: &[u32],
    count: u32,
    control: &Control,
) -> Result<(PathBuf, serde_json::Value)> {
    let sequence = spool::capture_sequence(spool, indices, count, count, control)?;
    let output = ffmpeg(
        binaries,
        FfmpegPlan {
            request,
            spool,
            sequence: &sequence,
            count,
            rate: request.fps,
            width: request.width,
            height: request.height,
            quality: request.quality,
        },
        control,
    )?;
    Ok((
        output,
        serde_json::json!({ "encoder": "ffmpeg", "codec": request.format.codec(),
        "width": request.width, "height": request.height, "fps": request.fps,
        "frame_count": count, "duration_seconds": count as f64 / request.fps.value(),
        "quality": request.quality, "webp_lossless": request.format == Format::Webp && request.quality == 100 }),
    ))
}
