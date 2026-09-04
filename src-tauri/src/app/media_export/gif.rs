//! Explicit GIF adapters. Size retries always start from the captured PNG master.
use super::{
    encode,
    process::{self, Control},
    spool::{self, Spool},
    types::*,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug)]
pub struct Attempt {
    pub width: u32,
    pub height: u32,
    pub count: u32,
    pub rate: Rate,
    pub quality: u8,
}
pub fn attempts(request: &BeginRequest, count: u32) -> Vec<Attempt> {
    let gif = request.gif.clone().unwrap_or_default();
    let quality = gif.quality.unwrap_or(request.quality);
    let resample = gif.size_policy.as_deref() == Some("quality_fps_scale");
    (0..if gif.max_bytes.is_some() { 5 } else { 1 })
        .map(|i| {
            let factor = if resample {
                [1.0, 0.875, 0.75, 0.625, 0.5][i]
            } else {
                1.0
            };
            let duration = count as f64 / request.fps.value();
            let fps = (request.fps.value() * factor).max(request.fps.value().min(5.0));
            let sampled = ((duration * fps).round() as u32).clamp(1, count);
            // count'/fps' == count/fps, including non-integral rates and fractional last holds.
            let numerator = sampled as u64 * request.fps.numerator as u64;
            let denominator = count as u64 * request.fps.denominator as u64;
            let divisor = gcd(numerator, denominator);
            let rate = if numerator / divisor <= u32::MAX as u64
                && denominator / divisor <= u32::MAX as u64
            {
                Rate {
                    numerator: (numerator / divisor) as u32,
                    denominator: (denominator / divisor) as u32,
                }
            } else {
                Rate {
                    numerator: (sampled as f64 / duration * 1_000_000.0).round() as u32,
                    denominator: 1_000_000,
                }
            };
            Attempt {
                width: ((request.width as f64 * factor).round() as u32).max(1),
                height: ((request.height as f64 * factor).round() as u32).max(1),
                count: sampled,
                rate,
                quality: (quality as f64 * [1.0, 0.8, 0.6, 0.4, 0.25][i])
                    .round()
                    .max(1.0) as u8,
            }
        })
        .collect()
}
fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let next = a % b;
        a = b;
        b = next;
    }
    a
}
fn gifski(
    binaries: &Binaries,
    request: &BeginRequest,
    spool: &Spool,
    sequence: &Path,
    attempt: &Attempt,
    control: &Control,
) -> Result<PathBuf> {
    let binary = binaries.gifski.as_ref().ok_or("gifski is unavailable")?;
    let options = request.gif.clone().unwrap_or_default();
    let output = spool.dir.join("candidate.gif");
    let prepared = spool.dir.join("opaque");
    let input = if request.alpha {
        sequence.to_owned()
    } else {
        if prepared.exists() {
            fs::remove_dir_all(&prepared).map_err(io)?;
        }
        fs::create_dir(&prepared).map_err(io)?;
        let mut args = encode::input(sequence, attempt.rate);
        args.extend([
            "-filter_complex".into(),
            encode::filter(request, attempt.width, attempt.height, "", attempt.rate),
            "-map".into(),
            "[out]".into(),
            "-frames:v".into(),
            attempt.count.to_string(),
            "-c:v".into(),
            "png".into(),
            "-threads".into(),
            "2".into(),
            "-start_number".into(),
            "0".into(),
            "-f".into(),
            "image2".into(),
            "-progress".into(),
            "pipe:1".into(),
            format!("{}/%06d.png", prepared.to_string_lossy().replace('%', "%%")),
        ]);
        process::run(
            &binaries.ffmpeg,
            &args,
            None,
            control,
            600,
            std::slice::from_ref(&spool.dir),
        )?;
        prepared
    };
    let rate = attempt.rate.value() * if attempt.count == 1 { 2.0 } else { 1.0 };
    let mut args = vec![
        "--quiet".into(),
        "--no-sort".into(),
        "--fps".into(),
        format!("{rate:.9}"),
        "--width".into(),
        attempt.width.to_string(),
        "--height".into(),
        attempt.height.to_string(),
        "--quality".into(),
        attempt.quality.to_string(),
        "--repeat".into(),
        options.repeat.to_string(),
        "--output".into(),
        output.to_string_lossy().into_owned(),
    ];
    if let Some(q) = options.motion_quality {
        args.extend(["--motion-quality".into(), q.to_string()]);
    }
    if let Some(q) = options.lossy_quality {
        args.extend(["--lossy-quality".into(), q.to_string()]);
    }
    args.push("--".into());
    // Extensionless four-digit aliases keep large PNG argument lists within OS limits.
    let limit = if cfg!(windows) { 30_000 } else { 230_000 };
    let aliases = attempt.count as u64
        * (format!("{:04x}", attempt.count.saturating_sub(1)).len() as u64
            + if cfg!(windows) { 3 } else { 9 });
    let fixed: u64 = args
        .iter()
        .map(|s| {
            if cfg!(windows) {
                s.encode_utf16().count() as u64 + 3
            } else {
                s.len() as u64 + 9
            }
        })
        .sum();
    if aliases + fixed > limit {
        return Err("gifski input list exceeds platform command-line bound; use FFmpeg GIF".into());
    }
    for i in 0..attempt.count {
        let name = format!("{i:04x}");
        fs::hard_link(input.join(format!("{i:06}.png")), input.join(&name)).map_err(io)?;
        args.push(name);
    }
    if attempt.count == 1 {
        args.push("0000".into());
    } // gifski CLI requires at least two inputs.
    let argv_size: usize = args
        .iter()
        .map(|s| {
            if cfg!(windows) {
                s.encode_utf16().count() + 3
            } else {
                s.len() + 9
            }
        })
        .sum();
    if argv_size > if cfg!(windows) { 30_000 } else { 230_000 } {
        return Err(
            "gifski input list exceeds platform command-line bound; use FFmpeg GIF or lower capture FPS"
                .into(),
        );
    }
    process::run(
        binary,
        &args,
        Some(&input),
        control,
        600,
        &[output.clone(), spool.dir.clone()],
    )?;
    Ok(output)
}
pub fn encode(
    binaries: &Binaries,
    request: &BeginRequest,
    spool: &Spool,
    indices: &[u32],
    count: u32,
    adapter: &str,
    control: &Control,
) -> Result<(PathBuf, Value)> {
    let target = request.gif.as_ref().and_then(|g| g.max_bytes);
    let mut history = Vec::new();
    let mut best: Option<(u64, Value)> = None;
    let saved = spool.dir.join("smallest.gif");
    for (n, attempt) in attempts(request, count).iter().enumerate() {
        control.check()?;
        let sequence = spool::capture_sequence(spool, indices, count, attempt.count, control)?;
        let output = if adapter == "gifski" {
            gifski(binaries, request, spool, &sequence, attempt, control)?
        } else {
            encode::ffmpeg(
                binaries,
                encode::FfmpegPlan {
                    request,
                    spool,
                    sequence: &sequence,
                    count: attempt.count,
                    rate: attempt.rate,
                    width: attempt.width,
                    height: attempt.height,
                    quality: attempt.quality,
                },
                control,
            )?
        };
        let size = fs::metadata(&output).map_err(io)?.len();
        let settings = json!({ "encoder": adapter, "width": attempt.width, "height": attempt.height,
            "fps": attempt.rate, "frame_count": attempt.count, "quality": attempt.quality,
            "actual_bytes": size, "duration_seconds": count as f64 / request.fps.value(),
            "attempt": n + 1 });
        history.push(settings.clone());
        if best.as_ref().is_none_or(|(smallest, _)| size < *smallest) {
            if saved.exists() {
                fs::remove_file(&saved).map_err(io)?;
            }
            fs::rename(&output, &saved).map_err(io)?;
            best = Some((size, settings));
        } else {
            fs::remove_file(&output).map_err(io)?;
        }
        if target.is_none_or(|limit| size <= limit) {
            break;
        }
    }
    let (size, mut settings) = best.ok_or("GIF encoder produced no attempts")?;
    settings["attempts"] = json!(history);
    settings["target_met"] = target
        .map(|limit| json!(size <= limit))
        .unwrap_or(Value::Null);
    settings["max_bytes"] = json!(target);
    settings["repeat"] = json!(request.gif.clone().unwrap_or_default().repeat);
    settings["motion_quality"] = json!(request.gif.as_ref().and_then(|g| g.motion_quality));
    settings["lossy_quality"] = json!(request.gif.as_ref().and_then(|g| g.lossy_quality));
    Ok((saved, settings))
}

pub fn gifski_frame_limit() -> u32 {
    if cfg!(windows) {
        3000
    } else {
        15000
    }
}
pub fn bounded_adapter(request: &BeginRequest, chosen: &str, count: u32) -> Result<String> {
    if chosen != "gifski" || count <= gifski_frame_limit() {
        return Ok(chosen.into());
    }
    let options = request.gif.clone().unwrap_or_default();
    if options.encoder != "auto"
        || options.motion_quality.is_some()
        || options.lossy_quality.is_some()
    {
        return Err("Long GIF exceeds gifski's platform argument bound; select FFmpeg and remove unsupported motion/lossy controls".into());
    }
    Ok("ffmpeg".into())
}
