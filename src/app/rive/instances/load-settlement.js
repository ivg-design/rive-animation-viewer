export function normalizeLoadErrorMessage(error, fallback = 'Animation load failed.') {
    if (error instanceof Error) return error.message || fallback;
    if (typeof error === 'string') return error || fallback;
    if (error === null || typeof error === 'undefined') return fallback;
    if (typeof error !== 'object') return String(error);

    for (const key of ['message', 'error', 'reason']) {
        let value;
        try {
            value = error[key];
        } catch {
            continue;
        }
        if (value === error) continue;
        const message = normalizeLoadErrorMessage(value, '');
        if (message) return message;
    }
    return fallback;
}

export function createLoadSettlement({
    onFailure = null,
    onRollback = () => {},
    onSuccess = null,
    onCommit = () => {},
    waitForActivation = false,
} = {}) {
    let settled = false;
    let resolveCompletion = null;
    let rejectCompletion = null;
    const promise = waitForActivation
        ? new Promise((resolve, reject) => {
            resolveCompletion = resolve;
            rejectCompletion = reject;
        })
        : null;
    promise?.catch?.(() => {});

    function invoke(callback, value, label) {
        if (typeof callback !== 'function') return;
        try {
            callback(value);
        } catch (error) {
            console.warn(`[rive-viewer] ${label} callback failed:`, error);
        }
    }

    return {
        failure(error) {
            if (settled) return false;
            settled = true;
            onRollback();
            rejectCompletion?.(error || new Error('Animation load failed.'));
            invoke(onFailure, error, 'onLoadError');
            return true;
        },
        isSettled: () => settled,
        promise,
        success() {
            if (settled) return false;
            settled = true;
            onCommit();
            resolveCompletion?.(true);
            invoke(onSuccess, undefined, 'onLoaded');
            return true;
        },
    };
}
