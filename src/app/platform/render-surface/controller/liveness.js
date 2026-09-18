export const RENDER_SURFACE_FRAME_ACTIVITY_TIMEOUT_MS = 3_500;

// Metrics are child-originated frame receipts. Resetting one deadline from
// those receipts detects a dead renderer without polling runtime state.
export function createRenderSurfaceLivenessMonitor({
    getActiveSessionId = () => null,
    isPlaybackExpected = () => false,
    onStalled = () => {},
    timeoutMs = RENDER_SURFACE_FRAME_ACTIVITY_TIMEOUT_MS,
    windowRef = globalThis.window,
} = {}) {
    let armedSessionId = null;
    let timeoutId = null;

    function clear() {
        if (timeoutId !== null) windowRef.clearTimeout(timeoutId);
        timeoutId = null;
        armedSessionId = null;
    }

    function arm(sessionId) {
        clear();
        if (!sessionId || !isPlaybackExpected(sessionId)) return false;
        armedSessionId = sessionId;
        timeoutId = windowRef.setTimeout(() => {
            timeoutId = null;
            armedSessionId = null;
            if (sessionId !== getActiveSessionId() || !isPlaybackExpected(sessionId)) return;
            onStalled(sessionId);
        }, timeoutMs);
        return true;
    }

    function reconcile() {
        const sessionId = getActiveSessionId();
        if (!sessionId || !isPlaybackExpected(sessionId)) {
            clear();
            return false;
        }
        if (timeoutId !== null && armedSessionId === sessionId) return true;
        return arm(sessionId);
    }

    function acceptMetrics(payload) {
        const sessionId = payload?.sessionId;
        if (!sessionId || sessionId !== getActiveSessionId()) return false;
        return arm(sessionId);
    }

    return {
        acceptMetrics,
        clear,
        dispose: clear,
        getState: () => ({ armed: timeoutId !== null, sessionId: armedSessionId }),
        reconcile,
    };
}

export function createRenderSurfaceLivenessGuard({
    documentRef = globalThis.document,
    fatalRecovery,
    getActiveSessionId,
    isDisposed,
    isLoaded,
    isSurfacePresented = () => true,
    logEvent,
    protocol,
    windowRef,
}) {
    let suspended = false;
    let hostFocused = typeof documentRef?.hasFocus === 'function'
        ? documentRef.hasFocus()
        : true;
    let hostVisible = documentRef?.visibilityState !== 'hidden';
    const hostPresentationActive = () => hostFocused && hostVisible;
    const monitor = createRenderSurfaceLivenessMonitor({
        getActiveSessionId,
        isPlaybackExpected: (sessionId) => {
            const canonical = protocol.getState().canonicalState;
            return !suspended && hostPresentationActive()
                && isSurfacePresented()
                && !isDisposed() && isLoaded() && fatalRecovery.canAcceptCommands()
                && canonical?.sessionId === sessionId
                && canonical?.playback?.isPlaying === true;
        },
        onStalled: (sessionId) => {
            const message = 'Playback surface stopped producing frame activity.';
            protocol.quarantineSession(sessionId, message);
            logEvent('native', 'render-surface-frame-stalled', message, { sessionId });
            void fatalRecovery.handleActiveFailure(sessionId, message);
        },
        windowRef,
    });

    const handleBlur = () => {
        hostFocused = false;
        monitor.clear();
    };
    const handleFocus = () => {
        hostFocused = true;
        hostVisible = documentRef?.visibilityState !== 'hidden';
        monitor.reconcile();
    };
    const handleVisibilityChange = () => {
        hostVisible = documentRef?.visibilityState !== 'hidden';
        if (hostPresentationActive()) monitor.reconcile();
        else monitor.clear();
    };

    windowRef?.addEventListener?.('blur', handleBlur);
    windowRef?.addEventListener?.('focus', handleFocus);
    documentRef?.addEventListener?.('visibilitychange', handleVisibilityChange);

    return {
        acceptMetrics: monitor.acceptMetrics,
        clear: monitor.clear,
        dispose() {
            windowRef?.removeEventListener?.('blur', handleBlur);
            windowRef?.removeEventListener?.('focus', handleFocus);
            documentRef?.removeEventListener?.('visibilitychange', handleVisibilityChange);
            monitor.dispose();
        },
        getState: monitor.getState,
        reconcile: monitor.reconcile,
        setSuspended(value) {
            suspended = Boolean(value);
            if (suspended) monitor.clear();
            else monitor.reconcile();
        },
    };
}
