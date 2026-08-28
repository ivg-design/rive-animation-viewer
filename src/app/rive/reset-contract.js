import { AUTO_BOUND_VM_INSTANCE_KEY } from './view-model/instances.js';

export function normalizeResetViewModelInstanceKey(instanceKey) {
    if (instanceKey === AUTO_BOUND_VM_INSTANCE_KEY || instanceKey === null || typeof instanceKey === 'undefined') {
        return null;
    }
    if (typeof instanceKey === 'string' && !instanceKey.trim()) {
        return null;
    }
    return instanceKey;
}

/**
 * One reset payload for every caller. `null` means the runtime's auto-bound
 * instance; any other value, including numeric zero, is an explicit binding.
 */
export function buildPlaybackResetContract({
    artboard = null,
    playbackName = null,
    playbackType = null,
    viewModelInstanceKey = null,
} = {}) {
    const normalizedInstanceKey = normalizeResetViewModelInstanceKey(viewModelInstanceKey);
    return {
        artboard: artboard || undefined,
        animations: playbackType === 'animation' ? playbackName || undefined : undefined,
        autoBind: normalizedInstanceKey === null,
        autoplay: true,
        stateMachines: playbackType === 'stateMachine' ? playbackName || undefined : undefined,
        viewModelInstanceName: normalizedInstanceKey,
    };
}
