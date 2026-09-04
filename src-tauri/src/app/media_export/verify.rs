use super::{
    process::{self, Control},
    types::*,
};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy)]
pub struct ExpectedOutput {
    pub format: Format,
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
    pub duration: f64,
    pub rate: f64,
}

pub fn inspect(
    binaries: &Binaries,
    path: &Path,
    expected: ExpectedOutput,
    control: &Control,
) -> Result<Value> {
    let ExpectedOutput {
        format,
        width,
        height,
        frame_count: expected_count,
        duration,
        rate,
    } = expected;
    let mut args = process::strings(&[
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,duration:format=duration,size",
        "-of",
        "json",
    ]);
    // Header probe only; APNG packet durations are accumulated separately in bounded memory.
    if format == Format::Apng {
        args.extend(process::strings(&["-f", "apng", "-ignore_loop", "1"]));
    }
    args.push(path.to_str().ok_or("Non UTF-8 candidate path")?.into());
    let raw = process::run(&binaries.ffprobe, &args, None, control, 600, &[])?;
    let probe: Value = serde_json::from_slice(&raw).map_err(io)?;
    let stream = probe["streams"]
        .get(0)
        .ok_or("Encoded output has no video stream")?;
    if stream["width"].as_u64() != Some(width as u64)
        || stream["height"].as_u64() != Some(height as u64)
    {
        return Err("Encoded dimensions differ from resolved settings".into());
    }
    let codec = match format {
        Format::H264 => "h264",
        Format::H265 => "hevc",
        Format::Webm => "vp9",
        Format::Apng => "apng",
        Format::Gif => "gif",
        Format::Png => "png",
        Format::Jpg => "mjpeg",
        Format::Webp => "webp",
    };
    if stream["codec_name"].as_str() != Some(codec)
        && !(format == Format::Apng && expected_count == 1 && stream["codec_name"] == "png")
    {
        return Err("Encoded codec differs from requested format".into());
    }
    let mut measured = probe["format"]["duration"]
        .as_str()
        .or_else(|| stream["duration"].as_str())
        .and_then(|s| s.parse::<f64>().ok());
    if format == Format::Apng {
        measured = Some(apng_duration(binaries, path, control)?);
    }
    // Full decode: container headers alone do not establish valid image/video data.
    let mut decode = process::strings(&["-v", "error", "-xerror", "-nostdin", "-threads", "2"]);
    if format == Format::Webm {
        decode.extend(process::strings(&["-c:v", "libvpx-vp9"]));
    }
    if format == Format::Apng {
        decode.extend(process::strings(&["-f", "apng", "-ignore_loop", "1"]));
    }
    decode.extend([
        "-i".into(),
        path.to_string_lossy().into_owned(),
        "-map".into(),
        "0:v:0".into(),
        "-threads".into(),
        "2".into(),
        "-fps_mode".into(),
        "passthrough".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        "-f".into(),
        "null".into(),
        "-".into(),
    ]);
    let progress = process::run(&binaries.ffmpeg, &decode, None, control, 600, &[])?;
    let count = decoded_count(&progress, format, expected_count)?;
    if format.animated() {
        let actual = measured.ok_or("Encoded duration unavailable")?;
        let tolerance = if format == Format::Gif {
            0.021
        } else {
            (1.0 / rate).max(0.002)
        };
        if !actual.is_finite() || (actual - duration).abs() > tolerance {
            return Err(format!(
                "Encoded duration {actual:.6}s differs from source {duration:.6}s"
            ));
        }
    }
    Ok(
        json!({ "decoded_frames": count, "duration_seconds": measured,
        "timing_tolerance_seconds": if format == Format::Gif { 0.021 } else { 1.0 / rate }, "codec": codec }),
    )
}

// Called only after a successful strict decode. Never trust container frame counts or
// an intermediate progress block; bounded/truncated stdout must fail closed.
pub(crate) fn decoded_count(raw: &[u8], format: Format, expected: u32) -> Result<u32> {
    let text = std::str::from_utf8(raw).map_err(io)?;
    if !text.ends_with('\n') {
        return Err("Incomplete decode progress".into());
    }
    let (mut frame, mut final_count) = (None, None);
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if final_count.is_some() {
            return Err("Unexpected data after decode progress=end".into());
        }
        if let Some(value) = line.strip_prefix("frame=") {
            frame = Some(
                value
                    .trim()
                    .parse::<u32>()
                    .map_err(|_| "Invalid decoded frame count")?,
            );
        } else if let Some(value) = line.strip_prefix("progress=") {
            match value {
                "continue" => frame = None,
                "end" => {
                    final_count = Some(frame.take().ok_or("Missing final decoded frame count")?)
                }
                _ => return Err("Invalid decode progress marker".into()),
            }
        }
    }
    let count = final_count.ok_or("Missing decode progress=end")?;
    // GIF may coalesce repeated presentation frames; duration is checked separately.
    if count == 0 || (format != Format::Gif && count != expected) {
        return Err(format!("Decoded frame count {count}, expected {expected}"));
    }
    Ok(count)
}

// Demux timestamps, never decode frames or accumulate a packet-sized JSON array.
fn apng_duration(binaries: &Binaries, path: &Path, control: &Control) -> Result<f64> {
    let sum = Arc::new(Mutex::new((0.0f64, 0u64, false)));
    let observed = sum.clone();
    let mut args = process::strings(&[
        "-v",
        "error",
        "-f",
        "apng",
        "-ignore_loop",
        "1",
        "-select_streams",
        "v:0",
        "-show_entries",
        "packet=duration_time",
        "-of",
        "csv=p=0",
    ]);
    args.push(path.to_string_lossy().into_owned());
    process::run_lines(
        &binaries.ffprobe,
        &args,
        control,
        600,
        Arc::new(move |line| {
            if let Ok(mut sum) = observed.lock() {
                match line.trim().parse::<f64>() {
                    Ok(duration) if duration.is_finite() && duration >= 0.0 => {
                        sum.0 += duration;
                        sum.1 += 1;
                    }
                    _ => sum.2 = true,
                }
            }
        }),
    )?;
    let (duration, count, invalid) = *sum.lock().map_err(io)?;
    if invalid || count == 0 || !duration.is_finite() {
        return Err("Invalid APNG packet durations".into());
    }
    Ok(duration)
}
