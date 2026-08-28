export function createRenderSurfaceControllerState({
    activeSessionId,
    canAcceptCommands,
    documentRef,
    getFatalRecovery,
    isLoaded,
    logEvent,
    showError,
}) {
    function publishAuthorityState() {
        const recoveryState = getFatalRecovery()?.getState?.().state || 'idle';
        const detail = {
            activeSessionId: activeSessionId(),
            canAcceptCommands: canAcceptCommands(),
            isLoaded: isLoaded(),
            recoveryState,
        };
        const CustomEventCtor = documentRef?.defaultView?.CustomEvent || globalThis.CustomEvent;
        if (typeof documentRef?.dispatchEvent === 'function' && typeof CustomEventCtor === 'function') {
            documentRef.dispatchEvent(new CustomEventCtor('rav:render-surface-authority-change', { detail }));
        }
        return detail;
    }
    function invokeQuietly(command, args = {}, getTauriInvoker = () => null) {
        const invoke = getTauriInvoker();
        if (typeof invoke !== 'function') return Promise.resolve(false);
        return invoke(command, args).then(() => true).catch(() => false);
    }
    function handleCommandOverflow({ type }) {
        const message = `Playback command queue is full; ${type} was not sent.`;
        logEvent('native', 'render-surface-command-overflow', message);
        showError(message);
    }
    return { handleCommandOverflow, invokeQuietly, publishAuthorityState };
}

export function buildRenderSurfaceState({ isLoaded, isSetup, protocolState, activeSessionId,
    activatingSessionId, pendingCommands, sessionId, recoveryState, stagedReady,
    surfaceCreated, canAcceptCommands }) {
    return {
        isLoaded, isSetup, ...protocolState, activeSessionId, activatingSessionId,
        pendingCommands, sessionId, recoveryState, stagedReady, surfaceCreated, canAcceptCommands,
    };
}

export function createRenderSurfaceDisposer({ isDisposed, markDisposed, setLoaded, publishAuthorityState,
    loadTracker, protocol, activationCoordinator, boundsSync, resizeObserver, mutationObserver,
    documentRef, loadCurrentAnimation, eventRelay, imageReplayCache, windowRef, unlistenCallbacks,
    setMainCanvasVisible, setFpsState, invokeQuietly }) {
    return function dispose() {
        if (isDisposed()) return;
        markDisposed();
        setLoaded(false);
        publishAuthorityState();
        loadTracker.dispose(false);
        protocol.clear('Render surface controller disposed.');
        activationCoordinator.clear();
        boundsSync.dispose();
        resizeObserver?.disconnect?.();
        mutationObserver?.disconnect?.();
        documentRef?.removeEventListener?.('rav:animation-loaded', loadCurrentAnimation);
        eventRelay.dispose();
        imageReplayCache.clear();
        windowRef?.removeEventListener?.('resize', boundsSync.schedule);
        unlistenCallbacks.splice(0).forEach((unlisten) => unlisten());
        setMainCanvasVisible(true);
        setFpsState(documentRef, false);
        void invokeQuietly('close_render_surface');
    };
}
