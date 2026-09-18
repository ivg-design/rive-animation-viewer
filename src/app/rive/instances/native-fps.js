export function enableNativeFpsCounter(instance, onFps, isCurrent = () => true) {
    if (!instance || typeof instance.enableFPSCounter !== 'function' || typeof onFps !== 'function') {
        return false;
    }
    try {
        instance.enableFPSCounter((fps) => {
            const value = Number(fps);
            if (!isCurrent() || !Number.isFinite(value)) return;
            onFps(value);
        });
        return true;
    } catch (_) {
        return false;
    }
}

export function disableNativeFpsCounter(instance) {
    // WebGL2 releases currently advertise the wrapper method without exposing
    // its runtime implementation. Inspect the delegate before calling it.
    if (typeof instance?.disableFPSCounter !== 'function'
        || typeof instance?.runtime?.disableFPSCounter !== 'function') {
        return false;
    }
    try {
        instance.disableFPSCounter();
        return true;
    } catch (_) {
        return false;
    }
}
