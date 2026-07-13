function invokeRestoreHook(callback) {
    if (typeof callback !== 'function') {
        return;
    }
    try {
        callback();
    } catch (error) {
        console.warn('[rive-viewer] beforeUserOnLoad callback failed:', error);
    }
}

export function runUserOnLoadWithVmRestore({
    beforeUserOnLoad,
    riveInstance,
    userOnLoad,
} = {}) {
    invokeRestoreHook(beforeUserOnLoad);
    if (typeof userOnLoad !== 'function') {
        return;
    }

    const originalBind = riveInstance?.bindViewModelInstance;
    const hadOwnBind = Object.prototype.hasOwnProperty.call(riveInstance || {}, 'bindViewModelInstance');
    let bindWasWrapped = false;

    if (typeof originalBind === 'function' && typeof beforeUserOnLoad === 'function') {
        try {
            riveInstance.bindViewModelInstance = function (...args) {
                const result = originalBind.apply(this, args);
                invokeRestoreHook(beforeUserOnLoad);
                return result;
            };
            bindWasWrapped = riveInstance.bindViewModelInstance !== originalBind;
        } catch {
            bindWasWrapped = false;
        }
    }

    try {
        userOnLoad();
    } catch (error) {
        console.warn('Error in user onLoad:', error);
    } finally {
        if (bindWasWrapped) {
            try {
                if (hadOwnBind) {
                    riveInstance.bindViewModelInstance = originalBind;
                } else {
                    delete riveInstance.bindViewModelInstance;
                }
            } catch {
                /* noop */
            }
        }
    }
}
