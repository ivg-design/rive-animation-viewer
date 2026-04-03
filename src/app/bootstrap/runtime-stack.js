import { createRuntimeLoaderController } from '../platform/runtime-loader.js';
import { createTransparencyController } from '../platform/transparency-controller.js';

export function createRuntimeStack({
    elements,
    callbacks,
    state,
} = {}) {
    const {
        getCurrentRuntime,
        getCurrentFileName,
        getCurrentFilePreferenceId,
        getCurrentFileUrl,
        getCurrentRuntimeVersionToken,
        getRiveInstance,
        getTauriInvoker,
        isTauriEnvironment,
        loadRiveAnimation,
        logEvent,
        refreshInfoStrip,
        showError,
        updateVersionInfo,
    } = callbacks;
    const runtimeLoaderController = createRuntimeLoaderController({
        elements,
        state: {
            ...state,
            getCurrentRuntime,
            getCurrentFileName,
            getCurrentFilePreferenceId,
            getCurrentFileUrl,
            getRuntimeVersionToken: getCurrentRuntimeVersionToken,
        },
        callbacks: {
            loadRiveAnimation,
            logEvent,
            reloadCurrentAnimation: callbacks.refreshCurrentState,
            refreshInfoStrip,
            showError,
            updateVersionInfo,
        },
    });

    const transparencyController = createTransparencyController({
        callbacks: {
            logEvent,
        },
        elements,
        getCurrentRuntime,
        getRiveInstance,
        getTauriInvoker,
        isTauriEnvironment,
    });

    return {
        runtimeLoaderController,
        transparencyController,
    };
}
