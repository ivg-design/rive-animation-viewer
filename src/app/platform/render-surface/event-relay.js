import {
    RAV_PLAYBACK_COMMAND_EVENT,
    RAV_PRESENTATION_CHANGED_EVENT,
    RAV_VM_CONTROL_MUTATED_EVENT,
} from '../../rive/control-events.js';
import { TIMELINE_PROGRESS_EVENT } from '../../rive/timeline-progress.js';

export function dispatchCanonicalTimelineProgress(documentRef, state) {
    const CustomEventCtor = documentRef?.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (typeof documentRef?.dispatchEvent !== 'function' || typeof CustomEventCtor !== 'function') return;
    const playback = state?.playback || {};
    documentRef.dispatchEvent(new CustomEventCtor(TIMELINE_PROGRESS_EVENT, {
        detail: {
            currentFrame: playback.currentFrame,
            currentSeconds: playback.currentSeconds,
            fps: playback.fps,
            playbackType: playback.type,
            totalFrames: playback.totalFrames,
            totalSeconds: playback.totalSeconds ?? playback.durationSeconds,
        },
    }));
}

export function createRenderSurfaceEventRelay({
    commandRelay,
    documentRef,
    getPresentationState = () => ({}),
    onImageCommand = () => {},
} = {}) {
    let presentationState = {};

    function readPresentationState(detail = {}) {
        let current = {};
        try { current = getPresentationState() || {}; } catch {}
        presentationState = { ...presentationState, ...current, ...detail };
        return presentationState;
    }

    function handleControlMutation(event) {
        const detail = event?.detail;
        const descriptor = detail?.descriptor;
        if (!descriptor || !detail?.kind) return;
        const isStateMachine = descriptor.source === 'state-machine';
        const isTrigger = detail.action === 'fire' || detail.kind === 'trigger';
        const isImage = detail.kind === 'image';
        const command = isImage
            ? 'vm-image-set'
            : (isStateMachine
                ? (isTrigger ? 'sm-fire' : 'sm-set')
                : (isTrigger ? 'vm-fire' : 'vm-set'));
        const payload = {
            ...descriptor,
            ...(isImage ? { action: detail.action } : {}),
            ...(isImage && Object.hasOwn(detail, 'imageSelection') ? { imageSelection: detail.imageSelection } : {}),
            kind: detail.kind,
            value: detail.value,
        };
        if (isImage) onImageCommand(payload);
        commandRelay.relay(command, payload);
    }

    function handlePlaybackCommand(event) {
        const command = event?.detail?.command;
        if (command === 'play' || command === 'pause' || command === 'reset') {
            commandRelay.relay(command, event?.detail?.payload || {});
        }
    }

    function handlePresentationChange(event) {
        commandRelay.relay('presentation', readPresentationState(event?.detail));
    }

    return {
        dispose() {
            documentRef?.removeEventListener?.(RAV_VM_CONTROL_MUTATED_EVENT, handleControlMutation);
            documentRef?.removeEventListener?.(RAV_PLAYBACK_COMMAND_EVENT, handlePlaybackCommand);
            documentRef?.removeEventListener?.(RAV_PRESENTATION_CHANGED_EVENT, handlePresentationChange);
        },
        getPresentationState: () => readPresentationState(),
        setup() {
            readPresentationState();
            documentRef?.addEventListener?.(RAV_VM_CONTROL_MUTATED_EVENT, handleControlMutation);
            documentRef?.addEventListener?.(RAV_PLAYBACK_COMMAND_EVENT, handlePlaybackCommand);
            documentRef?.addEventListener?.(RAV_PRESENTATION_CHANGED_EVENT, handlePresentationChange);
        },
    };
}
