export const TIMELINE_PROGRESS_EVENT = 'rav:timeline-progress';
export const RENDER_SURFACE_CANONICAL_STATE_EVENT = 'rav:render-surface-state';
export const TIMELINE_EPSILON = 0.000001;
const DEFAULT_SCALE_TICKS = 11;

export function finiteTimelineNumber(value, fallback = null) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function clampTimelineValue(value, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeTimelineProgress(metrics = {}) {
    const playbackType = metrics.playbackType || metrics.type || null;
    const playbackName = metrics.playbackName || metrics.name || null;
    const fps = finiteTimelineNumber(metrics.fps, null);
    let totalFrames = finiteTimelineNumber(metrics.totalFrames, null);
    let currentFrame = finiteTimelineNumber(metrics.currentFrame, null);
    let totalSeconds = finiteTimelineNumber(metrics.totalSeconds ?? metrics.durationSeconds, null);
    let currentSeconds = finiteTimelineNumber(metrics.currentSeconds, null);
    if (totalSeconds === null && totalFrames !== null && fps && fps > 0) totalSeconds = totalFrames / fps;
    if (currentSeconds === null && currentFrame !== null && fps && fps > 0) currentSeconds = currentFrame / fps;
    if (totalFrames === null && totalSeconds !== null && fps && fps > 0) totalFrames = Math.max(0, Math.round(totalSeconds * fps));
    if (currentFrame === null && currentSeconds !== null && fps && fps > 0) currentFrame = Math.max(0, Math.round(currentSeconds * fps));
    const progress = totalSeconds !== null && totalSeconds > TIMELINE_EPSILON && currentSeconds !== null
        ? clampTimelineValue(currentSeconds / totalSeconds)
        : totalFrames !== null && totalFrames > 0 && currentFrame !== null
            ? clampTimelineValue(currentFrame / totalFrames)
            : 0;
    return Object.freeze({
        playbackName,
        playbackType,
        fps,
        isPaused: typeof metrics.isPaused === 'boolean' ? metrics.isPaused : null,
        isPlaying: typeof metrics.isPlaying === 'boolean' ? metrics.isPlaying : null,
        currentFrame: currentFrame === null ? null : Math.max(0, currentFrame),
        totalFrames: totalFrames === null ? null : Math.max(0, totalFrames),
        currentSeconds: currentSeconds === null ? null : Math.max(0, currentSeconds),
        totalSeconds: totalSeconds === null ? null : Math.max(0, totalSeconds),
        progress,
    });
}

export function formatTimelineSeconds(value, digits = 2) {
    const number = finiteTimelineNumber(value, null);
    return number === null ? '--' : number.toFixed(digits);
}

export function formatTimelineFrames(value) {
    const number = finiteTimelineNumber(value, null);
    return number === null ? '--' : String(Math.max(0, Math.round(number)));
}

function formatScaleSeconds(value, totalSeconds) {
    if (totalSeconds >= 60) {
        const minutes = Math.floor(value / 60);
        const seconds = value - minutes * 60;
        return `${minutes}:${seconds.toFixed(totalSeconds < 600 ? 1 : 0).padStart(totalSeconds < 600 ? 4 : 2, '0')}`;
    }
    const digits = totalSeconds < 10 ? 2 : (totalSeconds < 30 ? 1 : 0);
    return `${value.toFixed(digits)}s`;
}

export function buildTimelineScale(metrics, unit = 'frames', desiredTicks = DEFAULT_SCALE_TICKS) {
    const state = normalizeTimelineProgress(metrics);
    const total = unit === 'seconds' ? state.totalSeconds : state.totalFrames;
    if (total === null || total <= TIMELINE_EPSILON) return [];
    const maximumTicks = Math.max(2, Math.floor(finiteTimelineNumber(desiredTicks, DEFAULT_SCALE_TICKS)));
    const tickCount = unit === 'frames'
        ? Math.min(maximumTicks, Math.max(2, Math.round(total) + 1))
        : maximumTicks;
    const seen = new Set();
    const ticks = [];
    for (let index = 0; index < tickCount; index += 1) {
        const ratio = index / (tickCount - 1);
        const value = unit === 'frames' ? Math.round(total * ratio) : total * ratio;
        const key = unit === 'frames' ? String(value) : value.toFixed(6);
        if (seen.has(key)) continue;
        seen.add(key);
        ticks.push(Object.freeze({
            edge: index === 0 ? 'start' : (index === tickCount - 1 ? 'end' : null),
            label: unit === 'frames' ? formatTimelineFrames(value) : formatScaleSeconds(value, total),
            percent: clampTimelineValue(value / total) * 100,
            value,
        }));
    }
    return ticks;
}
