/**
 * Timeline progress presentation only. The renderer owns the clock.
 * Feed child-confirmed metrics to update(), or dispatch
 * `rav:timeline-progress` with the same detail object.
 */
export const TIMELINE_PROGRESS_EVENT = 'rav:timeline-progress';
// This event is emitted by the parent protocol only when an active visible
// render surface has accepted a canonical child state. It is deliberately a
// second, authoritative input to the progress UI: a replacement may change
// playback mode without emitting another animation clock tick.
export const RENDER_SURFACE_CANONICAL_STATE_EVENT = 'rav:render-surface-state';
const EPSILON = 0.000001;

function finiteNumber(value, fallback = null) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
        return fallback;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeTimelineProgress(metrics = {}) {
    const playbackType = metrics.playbackType || null;
    const fps = finiteNumber(metrics.fps, null);
    let totalFrames = finiteNumber(metrics.totalFrames, null);
    let currentFrame = finiteNumber(metrics.currentFrame, null);
    let totalSeconds = finiteNumber(metrics.totalSeconds, null);
    let currentSeconds = finiteNumber(metrics.currentSeconds, null);
    if (totalSeconds === null && totalFrames !== null && fps && fps > 0) totalSeconds = totalFrames / fps;
    if (currentSeconds === null && currentFrame !== null && fps && fps > 0) currentSeconds = currentFrame / fps;
    if (totalFrames === null && totalSeconds !== null && fps && fps > 0) totalFrames = Math.max(0, Math.round(totalSeconds * fps));
    if (currentFrame === null && currentSeconds !== null && fps && fps > 0) currentFrame = Math.max(0, Math.round(currentSeconds * fps));
    const progress = totalSeconds !== null && totalSeconds > EPSILON && currentSeconds !== null
        ? clamp(currentSeconds / totalSeconds)
        : totalFrames !== null && totalFrames > 0 && currentFrame !== null
            ? clamp(currentFrame / totalFrames)
            : 0;
    return Object.freeze({
        playbackType,
        fps,
        currentFrame: currentFrame === null ? null : Math.max(0, currentFrame),
        totalFrames: totalFrames === null ? null : Math.max(0, totalFrames),
        currentSeconds: currentSeconds === null ? null : Math.max(0, currentSeconds),
        totalSeconds: totalSeconds === null ? null : Math.max(0, totalSeconds),
        progress,
    });
}

export function formatTimelineSeconds(value, digits = 2) {
    const number = finiteNumber(value, null);
    return number === null ? '--' : number.toFixed(digits);
}

export function formatTimelineFrames(value) {
    const number = finiteNumber(value, null);
    return number === null ? '--' : String(Math.max(0, Math.round(number)));
}

function formatReadout(state, unit) {
    return unit === 'seconds'
        ? `${formatTimelineSeconds(state.currentSeconds)} / ${formatTimelineSeconds(state.totalSeconds)} S`
        : `${formatTimelineFrames(state.currentFrame)} / ${formatTimelineFrames(state.totalFrames)} FR`;
}

export function createTimelineProgressController({
    documentRef = globalThis.document,
    root = documentRef?.getElementById?.('timeline-progress'),
} = {}) {
    const readout = root?.querySelector?.('#timeline-progress-readout');
    const progressBar = root?.querySelector?.('#timeline-progress-bar');
    const unitButton = root?.querySelector?.('#timeline-progress-unit');
    let unit = root?.dataset?.unit === 'seconds' ? 'seconds' : 'frames';
    let state = normalizeTimelineProgress();

    function render() {
        if (!root) return;
        const visible = state.playbackType === 'animation';
        root.classList.toggle('is-visible', visible);
        root.setAttribute('aria-hidden', String(!visible));
        root.dataset.unit = unit;
        if (readout) readout.textContent = formatReadout(state, unit);
        if (progressBar) {
            progressBar.value = state.progress;
            progressBar.setAttribute('aria-valuetext', formatReadout(state, unit));
        }
        if (unitButton) {
            unitButton.textContent = unit === 'seconds' ? 'SECONDS' : 'FRAMES';
            unitButton.setAttribute('aria-label', `Show timeline time in ${unit === 'seconds' ? 'frames' : 'seconds'}`);
        }
    }

    function update(metrics = {}) {
        state = normalizeTimelineProgress(metrics);
        render();
        return state;
    }

    function updateFromCanonicalState(canonicalState) {
        const playback = canonicalState?.playback;
        // Never retain a previous timeline's timecode when the acknowledged
        // child becomes a state machine (or has no playable target). Passing
        // no frame values intentionally clears the visible model as well as
        // hiding its reserved chip.
        if (!playback || typeof playback !== 'object') {
            return update({ playbackType: null });
        }
        return update({
            currentFrame: playback.currentFrame,
            currentSeconds: playback.currentSeconds,
            fps: playback.fps,
            playbackType: playback.type || null,
            totalFrames: playback.totalFrames,
            totalSeconds: playback.totalSeconds ?? playback.durationSeconds,
        });
    }

    function toggleUnit() {
        unit = unit === 'seconds' ? 'frames' : 'seconds';
        render();
        return unit;
    }

    unitButton?.addEventListener('click', toggleUnit);
    documentRef?.addEventListener?.(TIMELINE_PROGRESS_EVENT, (event) => update(event.detail || {}));
    // The protocol only dispatches this after it has promoted a child state to
    // canonical authority. This guards the mode transition even when the last
    // timeline tick came from the retiring renderer.
    documentRef?.addEventListener?.(RENDER_SURFACE_CANONICAL_STATE_EVENT, (event) => updateFromCanonicalState(event.detail));
    render();
    return {
        getState: () => state,
        getUnit: () => unit,
        setUnit(nextUnit) {
            if (nextUnit === 'frames' || nextUnit === 'seconds') unit = nextUnit;
            render();
            return unit;
        },
        toggleUnit,
        update,
        updateFromCanonicalState,
    };
}
