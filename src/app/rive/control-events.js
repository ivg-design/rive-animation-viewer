export const RAV_ANIMATION_LOADED_EVENT = 'rav:animation-loaded';
export const RAV_PLAYBACK_COMMAND_EVENT = 'rav:playback-command';
export const RAV_VM_CONTROL_MUTATED_EVENT = 'rav:vm-control-mutated';

function dispatchDetailEvent(documentRef, eventName, detail) {
    const CustomEventCtor = documentRef?.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (!documentRef || typeof documentRef.dispatchEvent !== 'function' || typeof CustomEventCtor !== 'function') {
        return false;
    }
    return documentRef.dispatchEvent(new CustomEventCtor(eventName, { detail }));
}

export function dispatchAnimationLoaded(documentRef, detail = {}) {
    return dispatchDetailEvent(documentRef, RAV_ANIMATION_LOADED_EVENT, detail);
}

export function dispatchPlaybackCommand(documentRef, command) {
    return dispatchDetailEvent(documentRef, RAV_PLAYBACK_COMMAND_EVENT, { command });
}

export function dispatchVmControlMutation(documentRef, {
    action = 'set',
    descriptor,
    kind = descriptor?.kind,
    value = null,
} = {}) {
    if (!descriptor || typeof descriptor !== 'object') {
        return false;
    }
    return dispatchDetailEvent(documentRef, RAV_VM_CONTROL_MUTATED_EVENT, {
        action,
        descriptor: { ...descriptor },
        kind,
        value,
    });
}
