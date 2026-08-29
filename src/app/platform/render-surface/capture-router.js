const CAPTURE_TIMEOUT_MS = 60_000;
let activeRoute = null;

export function registerRenderSurfaceCaptureRoute(route) {
    activeRoute = route?.capture instanceof Function ? route : null;
    return () => { if (activeRoute === route) activeRoute = null; };
}

export function captureActiveRenderSurface() {
    if (!activeRoute || activeRoute.isActive?.() !== true) return null;
    return activeRoute.capture();
}

export function createRenderSurfaceCaptureSession({ getSessionId, isActive, sendCommand, windowRef = globalThis.window } = {}) {
    let sequence = 0;
    const pending = new Map();
    const capture = () => {
        if (isActive?.() !== true || !getSessionId?.()) return null;
        const requestId = `${getSessionId()}-capture-${++sequence}`;
        return new Promise((resolve, reject) => {
            const timer = windowRef.setTimeout(() => { pending.delete(requestId); reject(new Error(`Isolated render-surface capture timed out after ${CAPTURE_TIMEOUT_MS}ms`)); }, CAPTURE_TIMEOUT_MS);
            pending.set(requestId, { resolve, reject, timer });
            const rejectPending = (message) => {
                const entry = pending.get(requestId); if (!entry) return;
                windowRef.clearTimeout(entry.timer); pending.delete(requestId); entry.reject(new Error(message));
            };
            Promise.resolve().then(() => sendCommand('capture-canvas', { requestId })).then((result) => {
                if (result === true || result?.applied === true) return;
                const status = typeof result?.status === 'string' ? ` (${result.status})` : '';
                rejectPending(`Unable to request an isolated render-surface capture${status}`);
            }).catch((error) => rejectPending(
                `Unable to request an isolated render-surface capture: ${String(error?.message || error)}`,
            ));
        });
    };
    const unregister = registerRenderSurfaceCaptureRoute({ capture, isActive });
    return {
        handleResponse(payload = {}) {
            const entry = payload.requestId ? pending.get(payload.requestId) : null;
            if (!entry) return false;
            windowRef.clearTimeout(entry.timer); pending.delete(payload.requestId);
            if (payload.error) entry.reject(new Error(String(payload.error))); else entry.resolve(payload.result || null);
            return true;
        },
        dispose() { unregister(); pending.forEach((entry) => { windowRef.clearTimeout(entry.timer); entry.reject(new Error('Render surface was disposed during capture')); }); pending.clear(); },
    };
}
