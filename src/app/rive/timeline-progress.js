import {
    RENDER_SURFACE_CANONICAL_STATE_EVENT,
    TIMELINE_EPSILON,
    TIMELINE_PROGRESS_EVENT,
    buildTimelineScale,
    clampTimelineValue,
    finiteTimelineNumber,
    formatTimelineFrames,
    formatTimelineSeconds,
    normalizeTimelineProgress,
} from './timeline/model.js';

export {
    RENDER_SURFACE_CANONICAL_STATE_EVENT,
    TIMELINE_PROGRESS_EVENT,
    buildTimelineScale,
    formatTimelineFrames,
    formatTimelineSeconds,
    normalizeTimelineProgress,
} from './timeline/model.js';
export {
    captureTimelineProgressForInstance,
    createTimelineSeekHandler,
    dispatchTimelineProgress,
    seekRiveTimeline,
} from './timeline/runtime.js';

function formatReadout(state, unit) {
    return unit === 'seconds'
        ? `${formatTimelineSeconds(state.currentSeconds)} / ${formatTimelineSeconds(state.totalSeconds)} S`
        : `${formatTimelineFrames(state.currentFrame)} / ${formatTimelineFrames(state.totalFrames)} FR`;
}

function sliderModel(state, unit) {
    if (unit === 'seconds') {
        const maximum = state.totalSeconds ?? 0;
        const value = clampTimelineValue(state.currentSeconds ?? 0, 0, Math.max(maximum, 0));
        const step = state.fps && state.fps > 0 ? 1 / state.fps : Math.max(maximum / 1000, 0.001);
        return { maximum, step, value };
    }
    const maximum = state.totalFrames ?? 0;
    return { maximum, step: 1, value: clampTimelineValue(Math.round(state.currentFrame ?? 0), 0, Math.max(maximum, 0)) };
}

function previewStateFromSlider(state, unit, rawValue) {
    const model = sliderModel(state, unit);
    const value = clampTimelineValue(finiteTimelineNumber(rawValue, 0), 0, Math.max(0, model.maximum));
    const progress = model.maximum > TIMELINE_EPSILON ? value / model.maximum : 0;
    if (unit === 'seconds') {
        return normalizeTimelineProgress({
            ...state,
            currentFrame: state.fps && state.fps > 0
                ? Math.round(value * state.fps)
                : (state.totalFrames === null ? null : state.totalFrames * progress),
            currentSeconds: value,
        });
    }
    return normalizeTimelineProgress({
        ...state,
        currentFrame: Math.round(value),
        currentSeconds: state.fps && state.fps > 0
            ? value / state.fps
            : (state.totalSeconds === null ? null : state.totalSeconds * progress),
    });
}

export function createTimelineProgressController({
    cancelFrame = null,
    documentRef = globalThis.document,
    now = null,
    onSeek = async () => ({ applied: false, status: 'unavailable' }),
    requestFrame = null,
    root = documentRef?.getElementById?.('timeline-progress'),
} = {}) {
    const readout = root?.querySelector?.('#timeline-progress-readout');
    const progressBar = root?.querySelector?.('#timeline-progress-bar');
    const scale = root?.querySelector?.('#timeline-progress-scale');
    const unitButton = root?.querySelector?.('#timeline-progress-unit');
    let unit = root?.dataset?.unit === 'seconds' ? 'seconds' : 'frames';
    let state = normalizeTimelineProgress();
    let confirmedState = state;
    let isScrubbing = false;
    let pendingSeek = null;
    let seekDrain = null;
    let scaleKey = '';
    let presentationFrame = null;
    let presentationAnchor = null;
    const windowRef = documentRef?.defaultView || globalThis.window;
    const readNow = typeof now === 'function'
        ? now
        : () => windowRef?.performance?.now?.() ?? Date.now();
    const requestPresentationFrame = typeof requestFrame === 'function'
        ? requestFrame
        : windowRef?.requestAnimationFrame?.bind(windowRef);
    const cancelPresentationFrame = typeof cancelFrame === 'function'
        ? cancelFrame
        : windowRef?.cancelAnimationFrame?.bind(windowRef);

    function cancelPresentationClock() {
        if (presentationFrame !== null && typeof cancelPresentationFrame === 'function') {
            cancelPresentationFrame(presentationFrame);
        }
        presentationFrame = null;
        presentationAnchor = null;
    }

    function canRunPresentationClock(nextState = state) {
        return !isScrubbing
            && nextState.playbackType === 'animation'
            && nextState.isPlaying === true
            && nextState.currentSeconds !== null
            && nextState.totalSeconds !== null
            && nextState.totalSeconds > TIMELINE_EPSILON
            && typeof requestPresentationFrame === 'function';
    }

    function schedulePresentationClock() {
        if (presentationFrame !== null || !canRunPresentationClock()) return;
        presentationFrame = requestPresentationFrame(presentPresentationFrame);
    }

    function presentPresentationFrame(timestamp) {
        presentationFrame = null;
        if (!presentationAnchor || !canRunPresentationClock()) return;
        const frameTime = Number.isFinite(Number(timestamp)) ? Number(timestamp) : readNow();
        const elapsedSeconds = Math.max(0, frameTime - presentationAnchor.time) / 1000;
        const currentSeconds = clampTimelineValue(
            presentationAnchor.seconds + elapsedSeconds,
            0,
            state.totalSeconds,
        );
        state = normalizeTimelineProgress({
            ...confirmedState,
            currentFrame: state.fps && state.fps > 0 ? Math.round(currentSeconds * state.fps) : state.currentFrame,
            currentSeconds,
        });
        render();
        if (currentSeconds < state.totalSeconds - TIMELINE_EPSILON) schedulePresentationClock();
    }

    function synchronizePresentationClock() {
        if (!canRunPresentationClock()) {
            cancelPresentationClock();
            return;
        }
        presentationAnchor = { seconds: state.currentSeconds, time: readNow() };
        schedulePresentationClock();
    }

    function renderScale() {
        if (!scale) return;
        const nextKey = `${unit}:${state.totalFrames ?? 'x'}:${state.totalSeconds ?? 'x'}:${state.fps ?? 'x'}`;
        if (nextKey === scaleKey) return;
        scaleKey = nextKey;
        scale.replaceChildren(...buildTimelineScale(state, unit).map((tick) => {
            const element = documentRef.createElement('span');
            element.className = 'timeline-progress-tick';
            element.textContent = tick.label;
            element.style.left = `${tick.percent}%`;
            if (tick.edge) element.dataset.edge = tick.edge;
            return element;
        }));
    }

    function render() {
        if (!root) return;
        const visible = state.playbackType === 'animation';
        root.hidden = !visible;
        root.classList.toggle('is-visible', visible);
        root.classList.toggle('is-scrubbing', isScrubbing);
        root.setAttribute('aria-hidden', String(!visible));
        root.dataset.unit = unit;
        root.style.setProperty('--timeline-fill', `${clampTimelineValue(state.progress) * 100}%`);
        if (readout) readout.textContent = formatReadout(state, unit);
        if (progressBar) {
            const model = sliderModel(state, unit);
            const maximum = model.maximum > TIMELINE_EPSILON ? model.maximum : 1;
            progressBar.min = '0';
            progressBar.max = String(maximum);
            progressBar.step = String(model.step);
            progressBar.value = String(clampTimelineValue(model.value, 0, maximum));
            progressBar.disabled = !visible || model.maximum <= TIMELINE_EPSILON || state.totalSeconds === null;
            progressBar.setAttribute('aria-valuetext', formatReadout(state, unit));
            progressBar.title = `Drag to set ${unit === 'seconds' ? 'time' : 'frame'}`;
        }
        if (unitButton) {
            unitButton.textContent = unit === 'seconds' ? 'SECONDS' : 'FRAMES';
            unitButton.setAttribute('aria-label', `Show timeline time in ${unit === 'seconds' ? 'frames' : 'seconds'}`);
        }
        renderScale();
    }

    function update(metrics = {}, { allowBackward = false } = {}) {
        const nextState = normalizeTimelineProgress(metrics);
        confirmedState = nextState;
        if (!isScrubbing) {
            const samePlayingTimeline = !allowBackward
                && state.isPlaying === true
                && nextState.isPlaying === true
                && state.playbackName === nextState.playbackName
                && state.currentSeconds !== null
                && nextState.currentSeconds !== null;
            const frameTolerance = nextState.fps && nextState.fps > 0 ? 2 / nextState.fps : 0.034;
            const smallClockRegression = samePlayingTimeline
                && nextState.currentSeconds < state.currentSeconds
                && state.currentSeconds - nextState.currentSeconds <= frameTolerance;
            state = smallClockRegression
                ? normalizeTimelineProgress({
                    ...nextState,
                    currentFrame: state.currentFrame,
                    currentSeconds: state.currentSeconds,
                })
                : nextState;
            synchronizePresentationClock();
        }
        render();
        return confirmedState;
    }

    function updateFromCanonicalState(canonicalState) {
        const playback = canonicalState?.playback;
        if (!playback || typeof playback !== 'object') return update({ playbackType: null });
        return update({
            currentFrame: playback.currentFrame,
            currentSeconds: playback.currentSeconds,
            fps: playback.fps,
            isPaused: playback.isPaused,
            isPlaying: playback.isPlaying,
            playbackName: playback.name,
            playbackType: playback.type || null,
            totalFrames: playback.totalFrames,
            totalSeconds: playback.totalSeconds ?? playback.durationSeconds,
        }, { allowBackward: true });
    }

    function toggleUnit() {
        unit = unit === 'seconds' ? 'frames' : 'seconds';
        scaleKey = '';
        render();
        return unit;
    }

    async function drainSeeks() {
        let finalResult = null;
        while (pendingSeek) {
            const request = pendingSeek;
            pendingSeek = null;
            try {
                finalResult = await onSeek(request);
            } catch (error) {
                finalResult = { applied: false, message: error?.message || String(error), status: 'rejected' };
            }
            if (finalResult?.metrics) confirmedState = normalizeTimelineProgress(finalResult.metrics);
            if (request.release && !pendingSeek) {
                isScrubbing = false;
                state = finalResult?.applied === false ? confirmedState : (finalResult?.metrics ? confirmedState : request.metrics);
                synchronizePresentationClock();
                render();
            }
        }
        seekDrain = null;
        return finalResult;
    }

    function queueSeek(release = false) {
        if (state.playbackType !== 'animation' || state.totalSeconds === null) return null;
        pendingSeek = {
            frame: state.currentFrame,
            metrics: state,
            name: state.playbackName,
            progress: state.progress,
            release: release || Boolean(pendingSeek?.release),
            seconds: state.currentSeconds,
        };
        if (!seekDrain) seekDrain = drainSeeks();
        return seekDrain;
    }

    function beginScrub() {
        if (progressBar?.disabled) return;
        isScrubbing = true;
        cancelPresentationClock();
        root?.classList?.add('is-scrubbing');
    }

    function previewScrub() {
        if (!progressBar || progressBar.disabled) return;
        beginScrub();
        state = previewStateFromSlider(state, unit, progressBar.value);
        render();
        queueSeek(false);
    }

    function finishScrub() {
        if (!isScrubbing) return;
        if (progressBar && !progressBar.disabled) {
            state = previewStateFromSlider(state, unit, progressBar.value);
            render();
        }
        queueSeek(true);
    }

    const handleTimelineEvent = (event) => update(event.detail || {});
    const handleCanonicalEvent = (event) => updateFromCanonicalState(event.detail);
    unitButton?.addEventListener('click', toggleUnit);
    progressBar?.addEventListener('pointerdown', beginScrub);
    progressBar?.addEventListener('input', previewScrub);
    progressBar?.addEventListener('change', finishScrub);
    progressBar?.addEventListener('pointercancel', finishScrub);
    documentRef?.addEventListener?.(TIMELINE_PROGRESS_EVENT, handleTimelineEvent);
    documentRef?.addEventListener?.(RENDER_SURFACE_CANONICAL_STATE_EVENT, handleCanonicalEvent);
    render();
    return {
        dispose() {
            cancelPresentationClock();
            unitButton?.removeEventListener('click', toggleUnit);
            progressBar?.removeEventListener('pointerdown', beginScrub);
            progressBar?.removeEventListener('input', previewScrub);
            progressBar?.removeEventListener('change', finishScrub);
            progressBar?.removeEventListener('pointercancel', finishScrub);
            documentRef?.removeEventListener?.(TIMELINE_PROGRESS_EVENT, handleTimelineEvent);
            documentRef?.removeEventListener?.(RENDER_SURFACE_CANONICAL_STATE_EVENT, handleCanonicalEvent);
        },
        getState: () => state,
        getUnit: () => unit,
        isScrubbing: () => isScrubbing,
        setUnit(nextUnit) {
            if (nextUnit === 'frames' || nextUnit === 'seconds') {
                unit = nextUnit;
                scaleKey = '';
            }
            render();
            return unit;
        },
        toggleUnit,
        update,
        updateFromCanonicalState,
    };
}
