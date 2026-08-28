export function createRenderSurfaceFatalRecovery({
    getActiveSessionId,
    loadReplacement,
    onFailed = () => {},
    onRecovering = () => {},
} = {}) {
    let failedSessionId = null;
    let deliberateReplacementSessionId = null;
    let recoveryPromise = null;
    let state = 'idle';

    async function runRecovery(sessionId, reason) {
        let recovered = false;
        try {
            recovered = await loadReplacement?.();
        } catch {
            recovered = false;
        }
        if (state === 'recovering' && failedSessionId === sessionId && !recovered) {
            state = 'failed';
            onFailed({ reason, sessionId });
        }
        return Boolean(recovered);
    }

    function handleActiveFailure(sessionId, reason) {
        if (!sessionId || sessionId !== getActiveSessionId?.()) return false;
        if (state === 'recovering' && failedSessionId === sessionId) return recoveryPromise;
        if (state === 'failed' && failedSessionId === sessionId) return false;
        deliberateReplacementSessionId = null;
        failedSessionId = sessionId;
        state = 'recovering';
        onRecovering({ reason, sessionId });
        recoveryPromise = runRecovery(sessionId, reason).finally(() => {
            recoveryPromise = null;
        });
        return recoveryPromise;
    }

    function confirmReplacement(sessionId) {
        const automaticRecovery = state === 'recovering';
        const deliberateRecovery = state === 'failed' && sessionId === deliberateReplacementSessionId;
        if ((!automaticRecovery && !deliberateRecovery) || !sessionId || sessionId === failedSessionId) return false;
        deliberateReplacementSessionId = null;
        failedSessionId = null;
        state = 'idle';
        return true;
    }

    function beginDeliberateReplacement(sessionId) {
        if (state !== 'failed' || !sessionId || sessionId === failedSessionId) return false;
        deliberateReplacementSessionId = sessionId;
        return true;
    }

    function cancelDeliberateReplacement(sessionId) {
        if (!sessionId || deliberateReplacementSessionId !== sessionId) return false;
        deliberateReplacementSessionId = null;
        return true;
    }

    return {
        beginDeliberateReplacement,
        cancelDeliberateReplacement,
        canAcceptCommands: () => state === 'idle',
        canShowNativeSurface: () => state === 'idle',
        confirmReplacement,
        getState: () => ({ failedSessionId, state }),
        handleActiveFailure,
    };
}
