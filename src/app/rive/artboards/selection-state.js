import { normalizeStateMachineSelection } from '../default-state-machine.js';
import { getStateMachineNames } from '../runtime-compatibility.js';

export function selectionFromConfig({ artboard, configuredStateMachines = [], animations = null, hasConfiguredAnimation = false } = {}) {
    const selection = {};
    if (artboard) selection.artboardName = artboard;
    if (configuredStateMachines.length) {
        selection.playbackType = 'stateMachine';
        selection.playbackName = configuredStateMachines[0];
    } else if (hasConfiguredAnimation) {
        selection.playbackType = 'animation';
        selection.playbackName = Array.isArray(animations) ? animations[0] : animations;
    }
    return selection;
}

export function selectionAfterLoad(riveInstance, config = {}) {
    const configuredStateMachines = getStateMachineNames(config);
    const configuredAnimations = normalizeStateMachineSelection(config.animations);
    const playingStateMachines = normalizeStateMachineSelection(riveInstance?.playingStateMachineNames);
    const playingAnimations = normalizeStateMachineSelection(riveInstance?.playingAnimationNames);
    const selection = { artboardName: riveInstance?.artboard?.name || config.artboard || null };
    if (playingStateMachines.length) {
        selection.playbackType = 'stateMachine';
        selection.playbackName = playingStateMachines[0];
    } else if (playingAnimations.length) {
        selection.playbackType = 'animation';
        selection.playbackName = playingAnimations[0];
    } else if (configuredStateMachines.length) {
        selection.playbackType = 'stateMachine';
        selection.playbackName = configuredStateMachines[0];
    } else if (configuredAnimations.length) {
        selection.playbackType = 'animation';
        selection.playbackName = configuredAnimations[0];
    } else {
        selection.playbackType = null;
        selection.playbackName = null;
    }
    return selection;
}

export function buildArtboardStateSnapshot({ contents, currentArtboard, currentPlaybackName,
    currentPlaybackType, currentVmInstanceName, defaultArtboard, defaultPlaybackKey }) {
    return {
        contents,
        currentArtboard,
        currentPlaybackName,
        currentPlaybackType,
        currentVmInstanceName,
        defaultArtboard,
        defaultPlaybackKey,
    };
}

export function selectionFromCanonical(state, currentSelection) {
    if (!state) return null;
    const hasPlayback = Object.hasOwn(state, 'playback');
    const hasVmInstance = Object.hasOwn(state, 'vmInstance');
    const playback = state.playback || {};
    return {
        artboardName: state.artboard || currentSelection.artboardName,
        playbackType: hasPlayback ? (playback.type || null) : currentSelection.playbackType,
        playbackName: hasPlayback ? (playback.name || null) : currentSelection.playbackName,
        vmInstanceName: hasVmInstance ? (state.vmInstance?.key ?? null) : currentSelection.vmInstanceName,
    };
}

export function canonicalSelectionMatchesSource(state, currentScope, canonicalScope) {
    // Selection is an output of the canonical state, so compare source/runtime
    // here, not the artboard/VM keys that a legitimate same-file reset can change.
    return Boolean(currentScope?.sourceIdentity && currentScope.runtimeKey
        && canonicalScope?.sessionId && state?.sessionId === canonicalScope.sessionId
        && currentScope.sourceIdentity === canonicalScope.sourceIdentity
        && currentScope.runtimeKey === canonicalScope.runtimeKey);
}

export function resolveImplicitVmInstanceKey(targetArtboardName, currentSelection, confirmedSelection) {
    if (targetArtboardName === currentSelection?.artboardName) {
        return currentSelection.vmInstanceName;
    }
    // Rapid A -> B -> A selection can occur before B is visible. Restore A's
    // confirmed instance instead of applying B's staged Auto selection to A.
    if (targetArtboardName === confirmedSelection?.artboardName) {
        return confirmedSelection.vmInstanceName;
    }
    return null;
}
