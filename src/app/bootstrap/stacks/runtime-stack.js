import { createRuntimeLoaderController } from '../../platform/runtime/runtime-loader.js';
import { createCanvasBackgroundController } from '../../platform/canvas-background-controller.js';
import { createRuntimeInspectionController } from '../../platform/runtime/inspection-controller.js';

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

    const canvasBackgroundController = createCanvasBackgroundController({
        callbacks: {
            logEvent,
        },
        elements,
    });

    const inspectionController = createRuntimeInspectionController({
        getCurrentFileBuffer: callbacks.getCurrentFileBuffer,
        getCurrentFilePreferenceId, getCurrentRuntime,
        getCurrentRuntimeVersion: runtimeLoaderController.getCurrentRuntimeVersion,
    });
    return {
        inspectionController,
        canvasBackgroundController,
        runtimeLoaderController,
    };
}
