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
    // Authored playback multiplier (LinearAnimation `speed`, 1 = realtime). A
    // negative speed plays the timeline backwards: the indicator still travels
    // left to right while the frame/time values count down.
    const speedValue = finiteTimelineNumber(metrics.speed, 1);
    const speed = speedValue === 0 ? 0 : speedValue;
    const reversed = speed < 0;
    // Observed clock direction from the child (+1/-1); null until the clock has
    // moved. A ping-pong loop alternates it while the authored speed stays fixed.
    const directionValue = finiteTimelineNumber(metrics.direction, null);
    const direction = directionValue === 1 || directionValue === -1 ? directionValue : null;
    const forwardProgress = totalSeconds !== null && totalSeconds > TIMELINE_EPSILON && currentSeconds !== null
        ? clampTimelineValue(currentSeconds / totalSeconds)
        : totalFrames !== null && totalFrames > 0 && currentFrame !== null
            ? clampTimelineValue(currentFrame / totalFrames)
            : 0;
    const progress = reversed ? 1 - forwardProgress : forwardProgress;
    return Object.freeze({
        playbackName,
        playbackType,
        fps,
        reversed,
        speed,
        direction,
        isPaused: typeof metrics.isPaused === 'boolean' ? metrics.isPaused : null,
        isPlaying: typeof metrics.isPlaying === 'boolean' ? metrics.isPlaying : null,
        currentFrame: currentFrame === null ? null : Math.max(0, currentFrame),
        totalFrames: totalFrames === null ? null : Math.max(0, totalFrames),
        currentSeconds: currentSeconds === null ? null : Math.max(0, currentSeconds),
        totalSeconds: totalSeconds === null ? null : Math.max(0, totalSeconds),
        progress,
    });
}

// Direction the clock is travelling: the child's observed direction when it
// has one (ping-pong legs alternate), otherwise the sign of the authored speed.
export function travelDirection(state) {
    if (state.direction === 1 || state.direction === -1) return state.direction;
    return Number.isFinite(state.speed) && state.speed < 0 ? -1 : 1;
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

const FRAME_STEP_LADDER = [1, 2, 5, 10, 15, 30, 60, 120, 150, 300, 600, 1200, 1500, 3000, 6000, 12000, 15000, 30000, 60000];
const SECOND_STEP_LADDER = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
const MAX_MINOR_TICKS = 150;

function chooseScaleStep(total, ladder, maximumLabels) {
    for (const step of ladder) {
        if (Math.floor(total / step + TIMELINE_EPSILON) + 1 <= maximumLabels) return step;
    }
    return ladder[ladder.length - 1];
}

function chooseMinorStep(total, ladder, majorStep) {
    for (const step of ladder) {
        if (step > majorStep) break;
        if (total / step <= MAX_MINOR_TICKS && Math.abs(majorStep / step - Math.round(majorStep / step)) < 1e-9) return step;
    }
    return majorStep;
}

// Labels sit on "nice" steps (tens of frames on a 60-frame timeline, quarter
// seconds on a 2 s one) and every tick is placed at an exact frame or time
// value, so the CTI always lands on a mark. The end value is always labelled;
// a step label closer than 40% of a step to it is dropped to avoid overlap.
export function buildTimelineScale(metrics, unit = 'frames', desiredTicks = DEFAULT_SCALE_TICKS) {
    const state = normalizeTimelineProgress(metrics);
    const total = unit === 'seconds' ? state.totalSeconds : state.totalFrames;
    if (total === null || total <= TIMELINE_EPSILON) return [];
    const maximumLabels = Math.max(2, Math.floor(finiteTimelineNumber(desiredTicks, DEFAULT_SCALE_TICKS)));
    const ladder = unit === 'frames' ? FRAME_STEP_LADDER : SECOND_STEP_LADDER;
    const majorStep = chooseScaleStep(total, ladder, maximumLabels);
    // In seconds the minor ticks are the frames themselves whenever they fit,
    // so the CTI still lands on a mark; otherwise a fifth of the label step.
    const frameSeconds = state.fps && state.fps > 0 ? 1 / state.fps : null;
    const minorStep = unit === 'frames'
        ? chooseMinorStep(total, ladder, majorStep)
        : (frameSeconds && total / frameSeconds <= MAX_MINOR_TICKS ? frameSeconds : majorStep / 5);
    const format = (value) => (unit === 'frames' ? formatTimelineFrames(value) : formatScaleSeconds(value, total));
    const ticks = [];
    const push = (value, kind, edge = null) => ticks.push(Object.freeze({
        edge,
        kind,
        label: kind === 'major' ? format(value) : '',
        percent: clampTimelineValue(value / total) * 100,
        value,
    }));
    const majors = new Set([0]);
    for (let value = majorStep; value < total - majorStep * 0.4; value += majorStep) majors.add(Number(value.toFixed(6)));
    majors.add(Number(total.toFixed(6)));
    const minorCount = Math.floor(total / minorStep + TIMELINE_EPSILON);
    for (let index = 0; index <= minorCount; index += 1) {
        const value = Number((index * minorStep).toFixed(6));
        if (!majors.has(value) && value < total - TIMELINE_EPSILON) push(value, 'minor');
    }
    [...majors].sort((a, b) => a - b).forEach((value, index, list) => push(
        value,
        'major',
        index === 0 ? 'start' : (index === list.length - 1 ? 'end' : null),
    ));
    const ordered = ticks.sort((a, b) => a.value - b.value);
    if (!state.reversed) return ordered;
    // Reversed timeline: values run from `total` at the left edge down to 0.
    return ordered.map((tick) => Object.freeze({
        ...tick,
        edge: tick.edge === 'start' ? 'end' : (tick.edge === 'end' ? 'start' : null),
        percent: 100 - tick.percent,
    })).reverse();
}
