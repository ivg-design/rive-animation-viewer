export class RenderSurfaceLoadDeadlineError extends Error {
    constructor(phase, timeoutMs) {
        super(`Playback surface ${phase} exceeded the ${timeoutMs}ms load deadline.`);
        this.name = 'RenderSurfaceLoadDeadlineError';
        this.phase = phase;
        this.timeoutMs = timeoutMs;
    }
}

export function createRenderSurfaceLoadDeadline({
    now = () => Date.now(),
    timeoutMs,
    windowRef = globalThis,
} = {}) {
    const boundedTimeout = Math.max(1, Number(timeoutMs) || 1);
    let currentTimeoutMs = boundedTimeout;
    let deadlineAt = now() + boundedTimeout;
    let expired = false;
    const timeoutIds = new Set();

    const clear = (timeoutId) => {
        if (timeoutId === null || !timeoutIds.has(timeoutId)) return;
        windowRef.clearTimeout(timeoutId);
        timeoutIds.delete(timeoutId);
    };

    function runLateFulfilled(onLateFulfilled, value) {
        if (typeof onLateFulfilled !== 'function') return;
        try {
            Promise.resolve(onLateFulfilled(value)).catch(() => {});
        } catch {
            // Late cleanup is best-effort and must not become unhandled.
        }
    }

    function observeLateSettlement(operation, onLateFulfilled) {
        operation.then((value) => runLateFulfilled(onLateFulfilled, value), () => {
            // Every operation remains observed after the caller times out.
        });
    }

    function waitFor(operation, phase = 'load', { onLateFulfilled } = {}) {
        const observedOperation = Promise.resolve(operation);
        if (expired) {
            observeLateSettlement(observedOperation, onLateFulfilled);
            return Promise.reject(new RenderSurfaceLoadDeadlineError(phase, currentTimeoutMs));
        }
        const remaining = Math.max(0, deadlineAt - now());
        if (!remaining) {
            expired = true;
            observeLateSettlement(observedOperation, onLateFulfilled);
            return Promise.reject(new RenderSurfaceLoadDeadlineError(phase, currentTimeoutMs));
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            const timeoutId = windowRef.setTimeout(() => {
                if (settled) return;
                settled = true;
                timeoutIds.delete(timeoutId);
                expired = true;
                reject(new RenderSurfaceLoadDeadlineError(phase, currentTimeoutMs));
            }, remaining);
            timeoutIds.add(timeoutId);
            observedOperation.then((value) => {
                if (settled) {
                    runLateFulfilled(onLateFulfilled, value);
                    return;
                }
                settled = true;
                clear(timeoutId);
                resolve(value);
            }, (error) => {
                if (settled) return;
                settled = true;
                clear(timeoutId);
                reject(error);
            });
        });
    }

    return {
        dispose() {
            [...timeoutIds].forEach(clear);
        },
        extendFromNow(extensionMs) {
            if (expired || timeoutIds.size) return false;
            const boundedExtension = Math.max(1, Number(extensionMs) || 1);
            currentTimeoutMs = boundedExtension;
            deadlineAt = Math.max(deadlineAt, now() + boundedExtension);
            return true;
        },
        hasExpired: () => expired,
        waitFor,
    };
}

export function isRenderSurfaceLoadDeadlineError(error) {
    return error instanceof RenderSurfaceLoadDeadlineError;
}
