export const AUTO_BOUND_VM_INSTANCE_KEY = '__rav_auto_bound__';

export function buildViewModelInstanceLoadOverrides({
    artboardName = null,
    playbackName = null,
    playbackType = null,
} = {}) {
    const overrides = { artboard: artboardName, autoplay: true, autoBind: false };
    if (playbackType === 'stateMachine' && playbackName) {
        overrides.stateMachines = playbackName;
    } else if (playbackType === 'animation' && playbackName) {
        overrides.animations = playbackName;
    }
    return overrides;
}

export function resolveViewModelInstance(viewModelDefinition, instanceKey) {
    if (!viewModelDefinition || instanceKey === null || typeof instanceKey === 'undefined') {
        return null;
    }
    if (typeof viewModelDefinition.instanceByName === 'function') {
        try {
            const namedInstance = viewModelDefinition.instanceByName(String(instanceKey));
            if (namedInstance) {
                return namedInstance;
            }
        } catch {
            /* not a named instance */
        }
    }
    const index = Number.parseInt(String(instanceKey), 10);
    if (!Number.isNaN(index) && typeof viewModelDefinition.instanceByIndex === 'function') {
        try {
            return viewModelDefinition.instanceByIndex(index) || null;
        } catch {
            /* not an indexed instance */
        }
    }
    return null;
}

export function bindViewModelInstanceByKey(riveInstance, instanceKey) {
    const viewModelDefinition = typeof riveInstance?.defaultViewModel === 'function'
        ? riveInstance.defaultViewModel()
        : null;
    const newInstance = resolveViewModelInstance(viewModelDefinition, instanceKey);
    if (!newInstance || typeof riveInstance?.bindViewModelInstance !== 'function') {
        throw new Error(`ViewModel instance "${instanceKey}" is unavailable.`);
    }
    riveInstance.bindViewModelInstance(newInstance);
    return viewModelDefinition;
}

export function loadAndBindViewModelInstance({
    configOverrides,
    fileName,
    fileUrl,
    getRiveInstance,
    instanceKey,
    loadRiveAnimation,
    onBound = () => {},
}) {
    let bindError = null;
    let didBind = false;
    return new Promise((resolve, reject) => {
        const bindSelectedInstance = () => {
            try {
                const definition = bindViewModelInstanceByKey(getRiveInstance(), instanceKey);
                didBind = true;
                onBound(definition);
            } catch (error) {
                bindError = error;
            }
        };
        const resolveAfterLoad = () => didBind
            ? resolve()
            : reject(bindError || new Error(`ViewModel instance "${instanceKey}" could not be bound.`));
        loadRiveAnimation(fileUrl, fileName, {
            beforeUserOnLoad: bindSelectedInstance,
            configOverrides,
            forceAutoplay: true,
            onLoaded: resolveAfterLoad,
            onLoadError: reject,
        }).catch(reject);
    });
}
