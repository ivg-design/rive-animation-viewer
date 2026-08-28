export function createRenderSurfaceLoadTracker({ isStillStaged, onTimeout, timeoutMs, windowRef }) {
    let pending = null;
    let timeoutId = null;

    function clearTimeout() {
        if (timeoutId === null) return;
        windowRef.clearTimeout(timeoutId);
        timeoutId = null;
    }

    function armTimeout(sessionId) {
        clearTimeout();
        timeoutId = windowRef.setTimeout(() => {
            timeoutId = null;
            if (isStillStaged(sessionId)) onTimeout(sessionId);
        }, timeoutMs);
    }

    function begin(generation, sessionId) {
        return new Promise((resolve) => { pending = { generation, resolve, sessionId }; });
    }

    function settle(sessionId, result) {
        if (!pending || pending.sessionId !== sessionId) return;
        const resolve = pending.resolve;
        pending = null;
        resolve(result);
    }

    function dispose(result = false) {
        clearTimeout();
        if (pending) settle(pending.sessionId, result);
    }

    return { armTimeout, begin, clearTimeout, dispose, getPending: () => pending, settle };
}
