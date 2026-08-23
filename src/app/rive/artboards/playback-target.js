export function parsePlaybackTarget(target) {
    if (!target) return { type: null, name: null };
    if (target.startsWith('sm:')) return { type: 'stateMachine', name: target.slice(3) };
    if (target.startsWith('anim:')) return { type: 'animation', name: target.slice(5) };
    return { type: 'stateMachine', name: target };
}
