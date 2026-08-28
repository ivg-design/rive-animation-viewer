export function createRenderSurfaceAutoplayPolicy() {
    const requestedBySession = new Map();

    function begin(sessionId, autoplay) {
        requestedBySession.set(sessionId, typeof autoplay === 'boolean' ? autoplay : null);
    }

    function forget(sessionId) {
        requestedBySession.delete(sessionId);
    }

    function applyToPayload(sessionId, payload) {
        const autoplay = requestedBySession.get(sessionId);
        return typeof autoplay === 'boolean' ? { ...payload, autoplay } : payload;
    }

    function shouldPreserveActivePlayback(sessionId) {
        return typeof requestedBySession.get(sessionId) !== 'boolean';
    }

    function resolveReplacementCommand(sessionId, activePlayback, replacingActiveSurface) {
        if (!replacingActiveSurface || !shouldPreserveActivePlayback(sessionId)
            || typeof activePlayback?.isPlaying !== 'boolean') return null;
        return { payload: {}, type: activePlayback.isPlaying ? 'play' : 'pause' };
    }

    return {
        applyToPayload,
        begin,
        forget,
        resolveReplacementCommand,
    };
}
