export function parsePlaybackTarget(target) {
    if (!target) return { type: null, name: null };
    if (target.startsWith('sm:')) return { type: 'stateMachine', name: target.slice(3) };
    if (target.startsWith('anim:')) return { type: 'animation', name: target.slice(5) };
    return { type: 'stateMachine', name: target };
}

export function buildPlaybackResetParams(artboard, playbackType, playbackName) {
    const params = { artboard, autoplay: true, autoBind: true };
    if (playbackType === 'stateMachine' && playbackName) {
        params.stateMachines = playbackName;
    } else if (playbackType === 'animation' && playbackName) {
        params.animations = playbackName;
    }
    return params;
}
