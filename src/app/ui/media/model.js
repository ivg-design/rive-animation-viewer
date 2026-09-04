export const FORMATS = {
    png: 'PNG', jpg: 'JPG', webp: 'WebP', h264: 'H.264 / MP4',
    h265: 'H.265 / MP4', webm: 'WebM / VP9', apng: 'APNG', gif: 'GIF',
};
export const STILL_FORMATS = ['png', 'jpg', 'webp'];
export const ANIMATED_FORMATS = ['h264', 'h265', 'webm', 'apng', 'gif'];
export const isBusyJob = (job) => ['preparing', 'capturing', 'encoding'].includes(job?.state);
export const isRecording = (job) => job?.recording && ['preparing', 'capturing'].includes(job.state);
export const formatCapability = (caps, format) => caps?.formats?.find((item) => item.id === format);
export const supportsAlpha = (caps, format) => formatCapability(caps, format)?.alpha === true;
export const gifEncoder = (draft, caps) => draft.encoder === 'auto' ? caps?.gif?.resolved_auto_encoder : draft.encoder;
export const gifControl = (draft, caps, key) => gifEncoder(draft, caps) === 'gifski' && caps?.gif?.[key] === true;

export function sourceReason(mode, info) {
    if (!info?.playback) return 'Load a Rive file first.';
    if (mode === 'timeline' && info.playback.type !== 'animation') return 'Select a timeline to export its duration or a segment.';
    if (mode === 'record' && info.playback.type !== 'stateMachine') return 'Select a state machine to record live interactions.';
    return '';
}

export function createDraft(mode, info = {}, caps = {}, format) {
    const choices = mode === 'still' ? STILL_FORMATS : ANIMATED_FORMATS;
    const selected = format || choices.find((id) => formatCapability(caps, id)?.available) || choices[0];
    const sourceFps = info.playback?.fps || 60;
    const size = (value) => value == null ? '' : ['h264', 'h265', 'webm'].includes(selected)
        ? Math.max(2, Math.round(value / 2) * 2) : Math.round(value);
    return {
        mode, format: selected, range: 'full', range_unit: 'seconds', start: 0,
        end: info.playback?.durationSeconds ?? info.playback?.totalSeconds ?? '',
        at_mode: 'current', at_seconds: 0, at_frame: 0,
        width: size(info.width), height: size(info.height), aspect_lock: true, scale: '1',
        fps: Math.min(sourceFps, selected === 'gif' ? (caps.gif?.fps_max || 50) : (caps.limits?.max_fps || 60)),
        quality: 80, alpha: false, background: '#000000', cursor: false,
        stop_mode: 'manual', duration_seconds: 10, output_path: '',
        gif_preset: 'balanced', encoder: 'auto', repeat: 0,
        motion_quality: '', lossy_quality: '', target_mib: 5, size_policy: 'quality_only',
    };
}

export function changeDraft(draft, name, value, info, caps) {
    if (!(name in draft) || name === 'mode') return draft;
    const next = { ...draft, [name]: value };
    const even = ['h264', 'h265', 'webm'].includes(next.format);
    const round = (number) => even ? Math.max(2, Math.round(number / 2) * 2) : Math.max(1, Math.round(number));
    if (name === 'format' && even) {
        for (const key of ['width', 'height']) if (Number(next[key]) > 0) next[key] = round(Number(next[key]));
    }
    if (name === 'format' && value !== draft.format) next.output_path = '';
    if (name === 'scale') {
        next.width = round(info.width * Number(value));
        next.height = round(info.height * Number(value));
    }
    if (['width', 'height'].includes(name) && next.aspect_lock && info.width && info.height && Number(value) > 0) {
        const peer = name === 'width' ? 'height' : 'width';
        next[peer] = round(Number(value) * info[peer] / info[name]);
    }
    if (name === 'range_unit') {
        const factor = value === 'frames' ? (info.playback?.fps || 60) : 1 / (info.playback?.fps || 60);
        next.start = Number(draft.start) * factor;
        next.end = Number(draft.end) * factor;
        if (value === 'frames') { next.start = Math.round(next.start); next.end = Math.round(next.end); }
    }
    if (name === 'gif_preset') {
        next.quality = caps.gif?.[value]?.quality ?? ({ source: 80, balanced: 80, small: 60 }[value] ?? draft.quality);
        if (value === 'source') {
            next.width = info.width; next.height = info.height;
            next.fps = Math.min(info.playback?.fps || 60, caps.gif?.fps_max || 50);
            next.scale = '1';
        }
    }
    if (name === 'format' && value === 'gif') next.fps = Math.min(Number(next.fps), caps.gif?.fps_max || 50);
    if (!supportsAlpha(caps, next.format)) next.alpha = false;
    return next;
}

export function mediaOptions(draft, info, caps) {
    const reason = sourceReason(draft.mode, info);
    if (reason) throw new Error(reason);
    const capability = formatCapability(caps, draft.format);
    if (!capability?.available) throw new Error(capability?.reason || 'This encoder is unavailable.');
    const still = draft.mode === 'still';
    if (still !== STILL_FORMATS.includes(draft.format)) throw new Error('Choose a format for this capture mode.');
    const options = { format: draft.format, mode: still ? 'still' : 'timeline',
        alpha: draft.alpha === true, background: draft.background,
        cursor: draft.cursor === true };
    // PNG/APNG are lossless; do not forward a hidden, inapplicable quality value.
    if (!['png', 'apng'].includes(draft.format)) options.quality = Number(draft.quality);
    if (options.alpha && !supportsAlpha(caps, draft.format)) throw new Error('This encoder does not support transparency.');
    for (const key of ['width', 'height']) {
        if (draft[key] !== '') options[key] = Number(draft[key]);
        if (draft[key] !== '' && !(options[key] > 0)) throw new Error('Dimensions must be positive.');
    }
    // A still has no presentation rate; avoid irrelevant GIF/video FPS limits.
    options.fps = still ? 1 : Number(draft.fps);
    if (draft.output_path.trim()) options.output_path = draft.output_path.trim();
    if (draft.mode === 'record' && draft.stop_mode === 'duration') options.duration_seconds = Number(draft.duration_seconds);
    if (draft.mode === 'timeline' && draft.range === 'segment') {
        const frames = draft.range_unit === 'frames';
        options[frames ? 'start_frame' : 'start_seconds'] = Number(draft.start);
        options[frames ? 'end_frame' : 'end_seconds'] = Number(draft.end);
        if (frames && (!Number.isInteger(Number(draft.start)) || !Number.isInteger(Number(draft.end)))) throw new Error('Frame boundaries must be whole numbers.');
    }
    if (still && draft.at_mode !== 'current') {
        if (info.playback.type !== 'animation') throw new Error('A requested still time needs a timeline.');
        if (draft.at_mode === 'frame' && !Number.isInteger(Number(draft.at_frame))) throw new Error('Frame must be a whole number.');
        options.at_seconds = draft.at_mode === 'frame' ? Number(draft.at_frame) / info.playback.fps : Number(draft.at_seconds);
    }
    if (draft.format === 'gif') {
        options.gif_preset = draft.gif_preset;
        const encoder = gifEncoder(draft, caps);
        if (!caps.gif?.[`${encoder}_available`]) throw new Error('Selected GIF encoder is unavailable.');
        options.gif = { encoder: draft.encoder, repeat: Number(draft.repeat) };
        if (!Number.isInteger(options.gif.repeat) || options.gif.repeat < -1 || options.gif.repeat > 32767) throw new Error('GIF repeat must be -1 through 32767.');
        for (const key of ['motion_quality', 'lossy_quality']) {
            if (gifControl(draft, caps, key) && draft[key] !== '') {
                options.gif[key] = Number(draft[key]);
                if (!Number.isInteger(options.gif[key]) || options.gif[key] < 1 || options.gif[key] > 100) throw new Error('GIF quality controls must be 1–100.');
            }
        }
        if (draft.gif_preset === 'target-size') {
            if (!caps.gif?.size_policies?.includes(draft.size_policy)) throw new Error('This target-size policy is unavailable.');
            options.gif.max_bytes = Math.round(Number(draft.target_mib) * 1048576);
            options.gif.size_policy = draft.size_policy;
            if (!Number.isSafeInteger(options.gif.max_bytes) || options.gif.max_bytes <= 0) throw new Error('Enter a positive target size.');
        }
    }
    return options;
}

export function describeLimits(caps = {}) {
    const limits = caps.limits || {};
    return [
        limits.disk_reserve_bytes && 'No time limit · limited by available disk space',
        limits.max_edge && `${limits.max_edge}px maximum edge`,
        limits.max_pixels && `${limits.max_pixels.toLocaleString()} pixels`,
        limits.max_fps && `${limits.max_fps} FPS`,
        limits.max_frames && `${limits.max_frames.toLocaleString()} frames`,
        limits.max_duration_seconds && `${limits.max_duration_seconds}s per capture`,
        limits.max_output_bytes && `${Math.round(limits.max_output_bytes / 1048576)} MiB output`,
    ].filter(Boolean).join(' · ');
}
