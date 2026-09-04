const STATIC = new Set(['png', 'jpg', 'webp']);
const FORMATS = new Set([...STATIC, 'h264', 'h265', 'webm', 'apng', 'gif']);
const GIF_PRESETS = { balanced: { edge: 960, fps: 20, quality: 80 }, small: { edge: 480, fps: 12, quality: 60 } };
function finite(value, fallback) { return value == null ? fallback : Number(value); }

export function frameRate(value, fallback = 60) {
    const rate = typeof value === 'object' && value
        ? { numerator: Number(value.numerator), denominator: Number(value.denominator) }
        : { numerator: Math.round(finite(value, fallback) * 1000), denominator: 1000 };
    if (!Number.isInteger(rate.numerator) || !Number.isInteger(rate.denominator)
        || rate.numerator <= 0 || rate.denominator <= 0 || rate.numerator / rate.denominator > 120
        || rate.numerator / rate.denominator < 1) throw new Error('FPS must be between 1 and 120.');
    return rate;
}

export function resolveMediaOptions(input = {}, info = {}, recording = false, limits = {}) {
    const format = input.format || 'png';
    if (!FORMATS.has(format)) throw new Error('Unsupported media format.');
    const maxFrames = limits.max_frames ?? Number.MAX_SAFE_INTEGER, maxPixels = limits.max_pixels || 4194304;
    const maxDuration = limits.max_duration_seconds ?? Infinity;
    const still = STATIC.has(format);
    if (recording && still) throw new Error('Choose an animated format for recording.');
    const mode = recording ? 'record' : still ? 'still' : 'timeline';
    const width = finite(info.width, 1280), height = finite(info.height, 720);
    const scale = finite(input.scale, 1);
    if (!(scale > 0 && scale <= 8)) throw new Error('Scale must be greater than zero and no more than 8.');
    let outWidth = finite(input.width, width * scale);
    let outHeight = finite(input.height, input.width == null ? height * scale : outWidth * height / width);
    if (input.height != null && input.width == null) outWidth = outHeight * width / height;
    const fps = frameRate(input.fps, info.playback?.fps || 60);
    const preset = format === 'gif' ? GIF_PRESETS[input.gif_preset || 'balanced'] : null;
    if (preset) {
        const reduction = Math.min(1, preset.edge / Math.max(outWidth, outHeight));
        outWidth *= reduction; outHeight *= reduction;
        if (fps.numerator / fps.denominator > preset.fps) { fps.numerator = preset.fps; fps.denominator = 1; }
    }
    outWidth = Math.round(outWidth); outHeight = Math.round(outHeight);
    if (outWidth < 1 || outHeight < 1 || outWidth * outHeight > maxPixels || outWidth > (limits.max_edge || 4096) || outHeight > (limits.max_edge || 4096)) throw new Error(`Output exceeds the encoder limit (${maxPixels} pixels). Reduce its dimensions.`);
    if (format === 'gif' && input.fps == null && fps.numerator / fps.denominator > 50) { fps.numerator = 50; fps.denominator = 1; }
    if (fps.numerator / fps.denominator > (format === 'gif' ? 50 : (limits.max_fps || 60))) throw new Error('Frame rate exceeds encoder limits.');
    if (['h264', 'h265', 'webm'].includes(format) && (outWidth % 2 || outHeight % 2)) throw new Error('Video width and height must be even numbers.');
    const alpha = input.alpha === true;
    if (alpha && ['h264', 'h265', 'jpg'].includes(format)) throw new Error(`${format} does not support alpha in RAV. Choose WebM, APNG, PNG or WebP.`);
    const background = input.background || '#000000';
    if (!/^#[0-9a-f]{6}$/i.test(background)) throw new Error('Background must be a six digit hex color.');
    const gifQuality = format === 'gif' ? input.gif?.quality : null;
    if (gifQuality != null && input.quality != null && Number(input.quality) !== Number(gifQuality)) {
        throw new Error('quality and gif.quality conflict; supply one value or matching values.');
    }
    const quality = finite(input.quality ?? gifQuality, preset?.quality || 80);
    if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error('Quality must be 1–100.');
    const sourceFps = finite(info.playback?.fps, 60);
    const start = input.start_frame != null ? Number(input.start_frame) / sourceFps : finite(input.start_seconds, 0);
    const end = input.end_frame != null ? Number(input.end_frame) / sourceFps
        : finite(input.end_seconds, info.playback?.durationSeconds ?? info.playback?.totalSeconds);
    if (!recording && !still && (info.playback?.type !== 'animation' || !Number.isFinite(end)
        || !Number.isFinite(start) || start < 0 || end <= start
        || end > (info.playback?.durationSeconds ?? info.playback?.totalSeconds ?? end) + 1e-6)) {
        throw new Error('Select a timeline with known duration and a valid start/end segment.');
    }
    const at = input.at_seconds == null ? null : Number(input.at_seconds);
    if (at != null && (!Number.isFinite(at) || at < 0 || at > (info.playback?.durationSeconds ?? 0))) throw new Error('Still frame time is outside the timeline.');
    const recordingLimit = Math.min(maxDuration, maxFrames * fps.denominator / fps.numerator);
    const duration = input.duration_seconds == null ? null : Number(input.duration_seconds);
    if (duration != null && (!Number.isFinite(duration) || duration <= 0 || duration > recordingLimit)) throw new Error('Recording duration must be positive and within the advertised limits.');
    const frameCount = recording ? null : still ? 1 : Math.ceil((end - start) * fps.numerator / fps.denominator - 1e-8);
    if (!recording && (frameCount > maxFrames || end - start > maxDuration)) throw new Error(`Export exceeds the ${maxFrames} frame / ${maxDuration} second limit. Reduce the segment or frame rate.`);
    const gif = { encoder: 'auto', repeat: 0, ...input.gif, quality };
    if (input.gif_preset === 'target-size' && !(gif.max_bytes > 0)) throw new Error('Target size requires gif.max_bytes.');
    return { format, mode, width: outWidth, height: outHeight, fps, alpha, background, quality,
        ...(recording ? { interactions: input.interactions || [] } : {}),
        cursor: input.cursor === true, output_path: input.output_path, overwrite: input.overwrite === true,
        ...(format === 'gif' ? { gif } : {}), start_seconds: start, end_seconds: end,
        at_seconds: at, duration_seconds: duration, frame_count: frameCount,
        simulation_fps: sourceFps, source_timeline_fps: info.playback?.type === 'animation' ? sourceFps : null,
        warnings: format === 'gif' && alpha ? ['GIF supports binary transparency, not smooth alpha.'] : [] };
}

export function frameTime(options, index) {
    return options.mode === 'still' ? (options.at_seconds ?? 0)
        : options.start_seconds + index * options.fps.denominator / options.fps.numerator;
}
