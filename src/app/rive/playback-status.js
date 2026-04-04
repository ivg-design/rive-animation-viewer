function normalizeLabel(value) {
    const text = String(value || '').trim();
    return text.length > 0 ? text : null;
}

export function getViewModelInstanceLabel(riveInstance) {
    return normalizeLabel(riveInstance?.viewModelInstance?.name);
}

export function getViewModelDefinitionLabel(riveInstance) {
    if (!riveInstance) {
        return null;
    }

    try {
        const definition = typeof riveInstance.defaultViewModel === 'function'
            ? riveInstance.defaultViewModel()
            : null;
        return normalizeLabel(definition?.name);
    } catch {
        return null;
    }
}

export function getActiveViewModelLabel(riveInstance) {
    return getViewModelDefinitionLabel(riveInstance) || getViewModelInstanceLabel(riveInstance);
}

export function buildPlaybackContext({
    playbackState = {},
    riveInstance = null,
} = {}) {
    const artboardName = normalizeLabel(playbackState.currentArtboard || riveInstance?.artboard?.name);
    let playbackType = playbackState.currentPlaybackType || null;
    let playbackName = normalizeLabel(playbackState.currentPlaybackName);
    if (!playbackName) {
        const stateMachineName = normalizeLabel(riveInstance?.stateMachineNames?.[0]);
        const animationName = normalizeLabel(riveInstance?.animationNames?.[0]);
        if (stateMachineName) {
            playbackType = 'stateMachine';
            playbackName = stateMachineName;
        } else if (animationName) {
            playbackType = 'animation';
            playbackName = animationName;
        }
    }
    const instanceLabel = normalizeLabel(playbackState.currentVmInstanceName) || getViewModelInstanceLabel(riveInstance);
    const viewModelLabel = getViewModelDefinitionLabel(riveInstance) || instanceLabel;

    return {
        artboardName,
        instanceLabel,
        playbackName,
        playbackType,
        viewModelLabel,
    };
}

export function buildPlaybackStatusLabel(context = {}, prefix = 'Loaded') {
    const parts = [];
    if (context.artboardName) {
        parts.push(`[AB] ${context.artboardName}`);
    }
    if (context.playbackName) {
        parts.push(`[${context.playbackType === 'animation' ? 'ANIM' : 'SM'}] ${context.playbackName}`);
    }
    if (context.viewModelLabel) {
        parts.push(`[VM] ${context.viewModelLabel}`);
    }
    if (context.instanceLabel && context.instanceLabel !== context.viewModelLabel) {
        parts.push(`[INST] ${context.instanceLabel}`);
    }

    const summary = parts.join(' · ') || 'No animation loaded';
    return prefix ? `${prefix}: ${summary}` : summary;
}

export function buildArtboardSelectionSummary(context = {}) {
    const parts = [];
    if (context.artboardName) {
        parts.push(context.artboardName);
    }
    if (context.playbackName) {
        parts.push(context.playbackName);
    }
    if (context.instanceLabel) {
        parts.push(context.instanceLabel);
    }
    return parts.join(' / ') || 'No selection';
}
