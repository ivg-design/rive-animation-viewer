import {
    TIMELINE_EPSILON,
    TIMELINE_PROGRESS_EVENT,
    finiteTimelineNumber,
    normalizeTimelineProgress,
} from './model.js';

function readFiniteMember(target, names, minimum = undefined) {
    if (!target) return null;
    for (const name of names) {
        let value = null;
        try {
            value = typeof target[name] === 'function' ? target[name]() : target[name];
        } catch {
            value = null;
        }
        const number = finiteTimelineNumber(value, null);
        if (number !== null && (minimum === undefined || number >= minimum)) return number;
    }
    return null;
}

function activeTimelineWrapper(riveInstance, targetName) {
    const animations = Array.isArray(riveInstance?.animator?.animations) ? riveInstance.animator.animations : [];
    for (let index = animations.length - 1; index >= 0; index -= 1) {
        const animation = animations[index];
        if (animation?.name === targetName && animation.playing) return animation;
    }
    for (let index = animations.length - 1; index >= 0; index -= 1) {
        if (animations[index]?.name === targetName) return animations[index];
    }
    return null;
}

export function captureTimelineProgressForInstance(riveInstance, playbackState = {}) {
    const playbackType = playbackState.currentPlaybackType || playbackState.playbackType || playbackState.type || null;
    const playbackName = playbackState.currentPlaybackName || playbackState.playbackName || playbackState.name || null;
    if (playbackType !== 'animation' || !playbackName) return normalizeTimelineProgress({ playbackName, playbackType });
    const active = activeTimelineWrapper(riveInstance, playbackName);
    if (!active) return normalizeTimelineProgress({ playbackName, playbackType });
    const currentSeconds = readFiniteMember(active, ['time'], 0) ?? readFiniteMember(active.instance, ['time'], 0);
    const fps = readFiniteMember(active.animation, ['fps'], TIMELINE_EPSILON)
        ?? readFiniteMember(active.instance, ['fps'], TIMELINE_EPSILON)
        ?? readFiniteMember(active, ['fps'], TIMELINE_EPSILON);
    const totalFrames = readFiniteMember(active.animation, ['duration', 'durationFrames', 'totalFrames'], 0)
        ?? readFiniteMember(active.instance, ['duration', 'durationFrames', 'totalFrames'], 0)
        ?? readFiniteMember(active, ['durationFrames', 'totalFrames'], 0);
    const totalSeconds = readFiniteMember(active.animation, ['durationSeconds', 'totalSeconds'], 0)
        ?? readFiniteMember(active.instance, ['durationSeconds', 'totalSeconds'], 0)
        ?? readFiniteMember(active, ['durationSeconds', 'totalSeconds'], 0);
    const isPlaying = typeof riveInstance?.isPlaying === 'boolean'
        ? riveInstance.isPlaying
        : active.playing !== false;
    return normalizeTimelineProgress({
        currentSeconds,
        fps,
        isPaused: !isPlaying,
        isPlaying,
        playbackName,
        playbackType,
        totalFrames,
        totalSeconds,
    });
}

export function dispatchTimelineProgress(documentRef, metrics = {}) {
    const CustomEventCtor = documentRef?.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (typeof documentRef?.dispatchEvent !== 'function' || typeof CustomEventCtor !== 'function') return false;
    return documentRef.dispatchEvent(new CustomEventCtor(TIMELINE_PROGRESS_EVENT, { detail: metrics }));
}

export function seekRiveTimeline(riveInstance, name, seconds) {
    const timelineName = typeof name === 'string' ? name.trim() : '';
    const targetSeconds = finiteTimelineNumber(seconds, null);
    if (!riveInstance || !timelineName || targetSeconds === null || typeof riveInstance.scrub !== 'function') return false;
    // Completed one-shots have no wrapper. Recreate one paused so the retained
    // terminal timeline remains seekable backward.
    if (!activeTimelineWrapper(riveInstance, timelineName) && typeof riveInstance.pause === 'function') {
        riveInstance.pause(timelineName);
    }
    riveInstance.scrub(timelineName, Math.max(0, targetSeconds));
    return true;
}

export function createTimelineSeekHandler({
    getPlaybackState = () => ({}),
    getRiveInstance = () => null,
    isAuthoritativeChildMode = () => false,
    requestAuthoritativeCommand = async () => ({ applied: false, status: 'unavailable' }),
} = {}) {
    return async function seekTimeline(request = {}) {
        const playbackState = getPlaybackState() || {};
        const name = request.name || playbackState.currentPlaybackName;
        if (playbackState.currentPlaybackType !== 'animation' || !name) return { applied: false, status: 'unavailable' };
        if (isAuthoritativeChildMode()) {
            const result = await requestAuthoritativeCommand('scrub', {
                frame: request.frame,
                name,
                seconds: request.seconds,
            });
            const playback = result?.canonicalState?.playback;
            return {
                ...result,
                ...(playback ? { metrics: {
                    currentFrame: playback.currentFrame,
                    currentSeconds: playback.currentSeconds,
                    fps: playback.fps,
                    isPaused: playback.isPaused,
                    isPlaying: playback.isPlaying,
                    playbackName: playback.name,
                    playbackType: playback.type,
                    totalFrames: playback.totalFrames,
                    totalSeconds: playback.totalSeconds ?? playback.durationSeconds,
                } } : {}),
            };
        }
        const riveInstance = getRiveInstance();
        const applied = seekRiveTimeline(riveInstance, name, request.seconds);
        return {
            applied,
            metrics: applied ? captureTimelineProgressForInstance(riveInstance, playbackState) : null,
            status: applied ? 'applied' : 'unavailable',
        };
    };
}
